import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { createAgentRuntimeFromConfig } from './agent-runtime-factory';
import { DevelopmentAgentRuntime } from './development-agent-runtime';
import { CodingAgentRuntime, CodingAgentSessionStore, loadCodingAgentModuleForTest } from './coding-agent-runtime';

test('createAgentRuntimeFromConfig defaults to Pi openai/gpt-4o-mini', () => {
	const runtime = createAgentRuntimeFromConfig();

	assert.ok(runtime instanceof CodingAgentRuntime);
	assert.equal(runtime.provider, 'openai');
	assert.equal(runtime.model, 'gpt-4o-mini');
	assert.equal(runtime.options.temperature, 0.1);
	assert.equal(runtime.options.maxTokens, 1024);
	assert.equal(runtime.options.timeoutMs, 300_000);
});

test('createAgentRuntimeFromConfig passes model target, agent options, and command options', () => {
	const runtime = createAgentRuntimeFromConfig({
		agent: {
			provider: 'anthropic',
			model: 'claude-sonnet-test',
			auth: {
				path: '/tmp/pi-auth.json',
			},
			session: {
				enabled: true,
				max_turns: 8,
				cacheRetention: 'long',
			},
			options: {
				apiKey: 'sk-config',
				reasoning: 'medium',
				temperature: 0.2,
				maxTokens: 2048,
				timeoutMs: 900_000,
				maxRetries: 1,
				maxRetryDelayMs: 5000,
				metadata: { source: 'vantage-test' },
				headers: { 'x-test': 'yes' },
			},
			trace: {
				prompt_path: '/tmp/pi-prompt.txt',
				response_path: '/tmp/pi-response.txt',
			},
		},
		commands: {
			question: {
				options: {
					maxTokens: 1536,
				},
			},
			edit: {
				options: {
					timeoutMs: 60_000,
				},
			},
			annotate: {
				options: {
					maxTokens: 128,
					timeoutMs: 12_345,
				},
			},
		},
	});

	assert.ok(runtime instanceof CodingAgentRuntime);
	assert.equal(runtime.provider, 'anthropic');
	assert.equal(runtime.model, 'claude-sonnet-test');
	assert.deepEqual((runtime as CodingAgentRuntime & { auth?: { path?: string } }).auth, {
		path: '/tmp/pi-auth.json',
	});
	assert.deepEqual(runtime.options, {
		apiKey: 'sk-config',
		reasoning: 'medium',
		temperature: 0.2,
		maxTokens: 2048,
		timeoutMs: 900_000,
		maxRetries: 1,
		maxRetryDelayMs: 5000,
		metadata: { source: 'vantage-test' },
		headers: { 'x-test': 'yes' },
	});
	assert.deepEqual(runtime.commandOptions.annotate?.options, {
		maxTokens: 128,
		timeoutMs: 12_345,
	});
	assert.deepEqual(runtime.commandOptions.question?.options, {
		maxTokens: 1536,
	});
	assert.deepEqual(runtime.commandOptions.edit?.options, {
		timeoutMs: 60_000,
	});
});

test('CodingAgentRuntime loads ESM Pi SDK without CommonJS require fallback', async () => {
	const piAgent = await loadCodingAgentModuleForTest();

	assert.equal(typeof piAgent.createAgentSession, 'function');
	assert.equal(typeof piAgent.defineTool, 'function');
});

test('CodingAgentRuntime falls back to assistant replacement text when submit_edit is not called', async () => {
	let listener: ((event: { type: string; message?: unknown }) => void) | undefined;
	const fakeSession = {
		setActiveToolsByName() {},
		subscribe(value: typeof listener) {
			listener = value;
			return () => {
				listener = undefined;
			};
		},
		async prompt() {
			listener?.({
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: '```lua\nconst count = 1;\n```' }],
				},
			});
		},
		async abort() {},
		dispose() {},
	};
	const fakeStore = {
		async getOrCreate() {
			return fakeSession;
		},
		begin() {},
		end() {},
	} as unknown as CodingAgentSessionStore;
	const runtime = new CodingAgentRuntime({ store: fakeStore });

	const edit = await runtime.editSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 1, character: 1 },
		range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 16 },
		selectedText: 'const value = 1;',
		instruction: 'rename value to count',
	});

	assert.equal(edit.replacementText, 'const count = 1;');
});

test('CodingAgentRuntime falls back to assistant JSON when submit_search_results is not called', async () => {
	let listener: ((event: { type: string; message?: unknown }) => void) | undefined;
	const fakeSession = {
		setActiveToolsByName() {},
		subscribe(value: typeof listener) {
			listener = value;
			return () => {
				listener = undefined;
			};
		},
		async prompt() {
			listener?.({
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: JSON.stringify({ locations: [{ filePath: 'package.json', startLine: 1, startCharacter: 1, explanation: 'Defines the package metadata.' }] }) }],
				},
			});
		},
		async abort() {},
		dispose() {},
	};
	const fakeStore = {
		async getOrCreate() {
			return fakeSession;
		},
		begin() {},
		end() {},
	} as unknown as CodingAgentSessionStore;
	const runtime = new CodingAgentRuntime({ store: fakeStore });

	const result = await runtime.searchLocations({
		workspaceRoot: process.cwd(),
		filePath: `${process.cwd()}/package.json`,
		language: 'json',
		text: '{"name":"vantage.nvim"}',
		cursor: { line: 1, character: 1 },
		query: 'find value',
	});

	assert.equal(result.locations[0].filePath, 'package.json');
});

test('CodingAgentRuntime keeps submit_edit live when an explain command creates the singleton session first', async () => {
	let listener: ((event: { type: string; message?: unknown }) => void) | undefined;
	let initialSubmitEdit: { execute: (toolCallId: string, payload: unknown) => Promise<unknown> } | undefined;
	const fakeSession = {
		setActiveToolsByName() {},
		subscribe(value: typeof listener) {
			listener = value;
			return () => {
				listener = undefined;
			};
		},
		async prompt(prompt: string) {
			if (prompt.includes('User edit instruction:')) {
				await initialSubmitEdit?.execute('tool-call-1', { replacementText: 'const count = 1;' });
				return;
			}
			listener?.({
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'explanation response' }],
				},
			});
		},
		async abort() {},
		dispose() {},
	};
	const fakeStore = {
		async getOrCreate(options: { customTools: { name: string; execute: (toolCallId: string, payload: unknown) => Promise<unknown> }[] }) {
			initialSubmitEdit ??= options.customTools.find((tool) => tool.name === 'submit_edit');
			return fakeSession;
		},
		begin() {},
		end() {},
	} as unknown as CodingAgentSessionStore;
	const runtime = new CodingAgentRuntime({ store: fakeStore });
	const baseParams = {
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 1, character: 1 },
	};

	await runtime.explainSelection({
		...baseParams,
		selectedText: 'const value = 1;',
	});
	const edit = await runtime.editSelection({
		...baseParams,
		range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 16 },
		selectedText: 'const value = 1;',
		instruction: 'rename value to count',
	});

	assert.equal(edit.replacementText, 'const count = 1;');
});

test('createAgentRuntimeFromConfig keeps development runtime internal', () => {
	const runtime = createAgentRuntimeFromConfig({
		agent: {
			runtime: 'development',
		},
	});

	assert.ok(runtime instanceof DevelopmentAgentRuntime);
});
