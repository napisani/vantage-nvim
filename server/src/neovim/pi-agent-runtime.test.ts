import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	PiAgentRuntime,
	PiSdkRuntime,
	type PiAssistantMessage,
	type PiCompleteOptions,
	type PiContext,
	type PiRuntime,
} from './pi-agent-runtime';

interface RuntimeCall {
	provider: string;
	model: string;
	context: PiContext;
	options: PiCompleteOptions;
}

class RecordingRuntime implements PiRuntime {
	readonly calls: RuntimeCall[] = [];

	constructor(private readonly content: string) {}

	async complete(
		provider: string,
		model: string,
		context: PiContext,
		options: PiCompleteOptions
	): Promise<PiAssistantMessage> {
		this.calls.push({ provider, model, context, options });
		return {
			role: 'assistant',
			content: [{ type: 'text', text: this.content }],
		};
	}
}

function messageText(message: PiContext['messages'][number] | undefined): string {
	if (!message) {
		return '';
	}
	const content = message.content;
	if (typeof content === 'string') {
		return content;
	}
	return content.map((block) => block.type === 'text' ? block.text ?? '' : '').join('\n');
}

class HangingRuntime implements PiRuntime {
	readonly calls: RuntimeCall[] = [];

	complete(provider: string, model: string, context: PiContext, options: PiCompleteOptions): Promise<PiAssistantMessage> {
		this.calls.push({ provider, model, context, options });
		return new Promise<PiAssistantMessage>(() => {});
	}
}

class ErrorRuntime implements PiRuntime {
	async complete(): Promise<PiAssistantMessage> {
		return {
			role: 'assistant',
			content: [],
			stopReason: 'error',
			errorMessage: 'Connection error.',
		};
	}
}

test('PiAgentRuntime explainSelection uses openai/gpt-4o-mini defaults', async () => {
	const runtime = new RecordingRuntime('## Pi explanation');
	const agent = new PiAgentRuntime({ runtime });

	const result = await agent.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(agent.provider, 'openai');
	assert.equal(agent.model, 'gpt-4o-mini');
	assert.equal(result.markdown, '## Pi explanation');
	assert.equal(runtime.calls[0].provider, 'openai');
	assert.equal(runtime.calls[0].model, 'gpt-4o-mini');
	assert.equal(runtime.calls[0].options.apiKey, undefined);
	assert.equal(runtime.calls[0].options.timeoutMs, 300_000);
	assert.equal(runtime.calls[0].options.maxTokens, 1024);
	assert.equal(runtime.calls[0].options.temperature, 0.1);
	assert.equal(runtime.calls[0].context.messages.length, 1);
	assert.equal(runtime.calls[0].context.messages[0].role, 'user');
	assert.match(String(runtime.calls[0].context.messages[0].content), /Explain the selected code/i);
	assert.match(String(runtime.calls[0].context.messages[0].content), /const value = 1;/);
});

test('PiAgentRuntime passes explicit apiKey but delegates credentials when absent', async () => {
	const explicitRuntime = new RecordingRuntime('## From explicit key');
	const explicit = new PiAgentRuntime({
		options: { apiKey: 'sk-explicit' },
		runtime: explicitRuntime,
	});
	await explicit.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});
	assert.equal(explicitRuntime.calls[0].options.apiKey, 'sk-explicit');

	const delegatedRuntime = new RecordingRuntime('## From Pi credentials');
	const delegated = new PiAgentRuntime({ runtime: delegatedRuntime });
	await delegated.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});
	assert.equal(delegatedRuntime.calls[0].options.apiKey, undefined);
});

test('PiAgentRuntime annotateRange uses command options over shared agent options', async () => {
	const runtime = new RecordingRuntime(JSON.stringify({
		annotations: [
			{
				line: 1,
				text: 'second reuses first in the addition',
				severity: 'info',
			},
		],
	}));
	const agent = new PiAgentRuntime({
		model: 'gpt-test-mini',
		options: {
			maxTokens: 2048,
			timeoutMs: 900_000,
			reasoning: 'medium',
		},
		commandOptions: {
			annotate: {
				maxTokens: 128,
				timeoutMs: 12_345,
			},
		},
		runtime,
	});

	const result = await agent.annotateRange({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const first = 1;\nconst second = first + 1;',
		cursor: { line: 40, character: 0 },
		visibleRange: { startLine: 40, startCharacter: 0, endLine: 41, endCharacter: 25 },
		scopeText: 'const first = 1;\nconst second = first + 1;',
		candidateLines: [
			{ line: 0, text: 'const first = 1;' },
			{ line: 1, text: 'const second = first + 1;' },
		],
	});

	assert.deepEqual(result.annotations[0].range, {
		startLine: 41,
		startCharacter: 0,
		endLine: 41,
		endCharacter: 25,
	});
	assert.equal(result.telemetry?.runtime, 'pi');
	assert.equal(result.telemetry?.model, 'openai/gpt-test-mini');
	assert.equal(runtime.calls[0].options.timeoutMs, 12_345);
	assert.equal(runtime.calls[0].options.maxTokens, 128);
	assert.equal(runtime.calls[0].options.reasoning, 'medium');
	assert.match(String(runtime.calls[0].context.messages[0].content), /Candidate lines to annotate/i);
	assert.match(String(runtime.calls[0].context.messages[0].content), /1\| const second = first \+ 1;/);
});

test('PiAgentRuntime annotateRange enforces annotation timeout when the runtime hangs', { timeout: 500 }, async () => {
	const runtime = new HangingRuntime();
	const agent = new PiAgentRuntime({
		commandOptions: {
			annotate: { timeoutMs: 25 },
		},
		runtime,
	});

	await assert.rejects(
		() =>
			agent.annotateRange({
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const first = 1;\nconst second = first + 1;',
				cursor: { line: 40, character: 0 },
				visibleRange: { startLine: 40, startCharacter: 0, endLine: 41, endCharacter: 25 },
				scopeText: 'const first = 1;\nconst second = first + 1;',
				candidateLines: [
					{ line: 0, text: 'const first = 1;' },
					{ line: 1, text: 'const second = first + 1;' },
				],
			}),
		/Pi request timed out after 25ms/
	);
	assert.equal(runtime.calls[0].options.timeoutMs, 25);
	assert.ok(runtime.calls[0].options.signal instanceof AbortSignal);
});

test('PiAgentRuntime reports Pi runtime error messages from empty responses', async () => {
	const agent = new PiAgentRuntime({
		runtime: new ErrorRuntime(),
	});

	await assert.rejects(
		() =>
			agent.explainSelection({
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const value = 1;',
				cursor: { line: 0, character: 0 },
				selectedText: 'const value = 1;',
			}),
		/Pi agent runtime failed: Connection error/
	);
});

test('PiAgentRuntime writes prompt and raw response traces when configured', async () => {
	const traceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-pi-trace-'));
	const tracePromptPath = path.join(traceDirectory, 'prompt.txt');
	const traceResponsePath = path.join(traceDirectory, 'response.txt');
	const rawResponse = JSON.stringify({
		annotations: [
			{
				range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 16 },
				text: 'Trace annotation',
				severity: 'info',
			},
		],
	});
	try {
		const agent = new PiAgentRuntime({
			tracePromptPath,
			traceResponsePath,
			runtime: new RecordingRuntime(rawResponse),
		});

		await agent.annotateRange({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 0, character: 0 },
			scopeText: 'const value = 1;',
		});

		const prompt = await fs.readFile(tracePromptPath, 'utf8');
		const response = await fs.readFile(traceResponsePath, 'utf8');
		assert.match(prompt, /Return only JSON/i);
		assert.match(prompt, /const value = 1;/);
		assert.equal(response, rawResponse);
	} finally {
		await fs.rm(traceDirectory, { recursive: true, force: true });
	}
});

test('PiAgentRuntime shares a scoped session across commands with Pi session affinity', async () => {
	const runtime = new RecordingRuntime('## Session response');
	const agent = new PiAgentRuntime({
		options: { timeoutMs: 120000 },
		session: {
			enabled: true,
			max_turns: 12,
			cacheRetention: 'short',
		},
		runtime,
	});

	await agent.explainSelection({
		workspaceRoot: '/repo',
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
		lens: { mode: 'learning', text: 'I am learning TypeScript' },
	});
	await agent.reviewCurrentHunk({
		workspaceRoot: '/repo',
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		hunkText: 'const value = 1;',
		lens: { mode: 'learning', text: 'I am learning TypeScript' },
	});

	assert.equal(runtime.calls.length, 2);
	assert.equal(runtime.calls[0].options.sessionId, runtime.calls[1].options.sessionId);
	assert.equal(runtime.calls[0].options.cacheRetention, 'short');
	assert.equal(runtime.calls[1].context.messages.length, 3);
	assert.match(String(runtime.calls[1].context.messages[0].content), /Explain the selected code/i);
	assert.equal(runtime.calls[1].context.messages[1].role, 'assistant');
	assert.match(String(runtime.calls[1].context.messages[2].content), /Review the current hunk/i);
});

test('PiAgentRuntime injects agent context only when the context revision changes', async () => {
	const runtime = new RecordingRuntime('## Session response');
	const agent = new PiAgentRuntime({
		session: {
			enabled: true,
			max_turns: 12,
			cacheRetention: 'short',
		},
		runtime,
	});

	const base = {
		workspaceRoot: '/repo',
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
		lens: { mode: 'learning' as const, text: 'I am learning TypeScript' },
	};

	await agent.explainSelection({
		...base,
		agentContext: {
			path: '/repo/.vantage/agent-context.md',
			content: '# Agent Task Context\n\n## Goal\nFirst',
			revision: 'rev-1',
			truncated: false,
		},
	});
	await agent.explainSelection({
		...base,
		agentContext: {
			path: '/repo/.vantage/agent-context.md',
			content: '# Agent Task Context\n\n## Goal\nFirst',
			revision: 'rev-1',
			truncated: false,
		},
	});
	await agent.explainSelection({
		...base,
		agentContext: {
			path: '/repo/.vantage/agent-context.md',
			content: '# Agent Task Context\n\n## Goal\nSecond',
			revision: 'rev-2',
			truncated: false,
		},
	});

	assert.match(messageText(runtime.calls[0].context.messages[0]), /Agent Task Context Update/i);
	assert.match(messageText(runtime.calls[0].context.messages[0]), /## Goal\nFirst/);
	assert.doesNotMatch(messageText(runtime.calls[1].context.messages.at(-1)), /Agent Task Context Update/i);
	assert.equal(runtime.calls[1].context.messages.filter((message) => messageText(message).match(/Agent Task Context Update/i)).length, 1);
	assert.match(messageText(runtime.calls[2].context.messages[0]), /Agent Task Context Update/i);
	assert.match(messageText(runtime.calls[2].context.messages[0]), /## Goal\nSecond/);
	assert.doesNotMatch(JSON.stringify(runtime.calls[2].context.messages), /## Goal\\nFirst/);
});

test('PiAgentRuntime keeps bounded session history and drops failed turns', async () => {
	const failingRuntime = new ErrorRuntime();
	const failedAgent = new PiAgentRuntime({
		session: { enabled: true, max_turns: 2, cacheRetention: 'short' },
		runtime: failingRuntime,
	});
	await assert.rejects(
		() =>
			failedAgent.explainSelection({
				workspaceRoot: '/repo',
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const failed = true;',
				cursor: { line: 0, character: 0 },
				selectedText: 'const failed = true;',
			}),
		/Connection error/
	);

	const runtime = new RecordingRuntime('## Bounded response');
	const agent = new PiAgentRuntime({
		session: { enabled: true, max_turns: 2, cacheRetention: 'short' },
		runtime,
	});
	for (const value of [1, 2, 3, 4]) {
		await agent.explainSelection({
			workspaceRoot: '/repo',
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: `const value = ${value};`,
			cursor: { line: 0, character: 0 },
			selectedText: `const value = ${value};`,
		});
	}

	assert.equal(runtime.calls[3].context.messages.length, 5);
	assert.doesNotMatch(JSON.stringify(runtime.calls[3].context.messages), /const value = 1/);
	assert.match(JSON.stringify(runtime.calls[3].context.messages), /const value = 2/);
	assert.match(JSON.stringify(runtime.calls[3].context.messages), /const value = 3/);
	assert.match(JSON.stringify(runtime.calls[3].context.messages), /const value = 4/);
});

test('PiAgentRuntime can reset and report the current scoped session', async () => {
	const runtime = new RecordingRuntime('## Session response');
	const agent = new PiAgentRuntime({
		session: { enabled: true, max_turns: 12, cacheRetention: 'short' },
		runtime,
	});
	const params = {
		workspaceRoot: '/repo',
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
		lens: { mode: 'learning' as const },
	};

	await agent.explainSelection(params);
	const status = await agent.agentSessionStatus(params);
	assert.match(status.markdown, /Turn count: 1/);
	assert.match(status.markdown, /Workspace: `\/repo`/);

	await agent.agentSessionReset(params);
	const resetStatus = await agent.agentSessionStatus(params);
	assert.match(resetStatus.markdown, /Turn count: 0/);
});

test('PiSdkRuntime reports unknown provider and model before calling the SDK completion path', async () => {
	const runtime = new PiSdkRuntime();

	await assert.rejects(
		() =>
			runtime.complete('unknown-provider', 'unknown-model', {
				messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
			}, {
				timeoutMs: 100,
				maxTokens: 16,
				temperature: 0.1,
			}),
		/Unknown Pi model "unknown-provider\/unknown-model"/
	);
});
