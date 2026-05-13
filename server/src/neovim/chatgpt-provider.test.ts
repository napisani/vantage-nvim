import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	ChatGptProvider,
	OpenAiSdkRuntime,
	type ChatGptGenerateOptions,
	type ChatGptRuntime,
} from './chatgpt-provider';

interface RuntimeCall {
	prompt: string;
	apiKey: string;
	model: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

class RecordingRuntime implements ChatGptRuntime {
	readonly calls: RuntimeCall[] = [];
	constructor(private readonly content: string) {}

	async generate(prompt: string, options: ChatGptGenerateOptions): Promise<string> {
		this.calls.push({ prompt, ...options });
		return this.content;
	}
}

test('ChatGptProvider explainSelection uses injected runtime with gpt-4o-mini by default', async () => {
	const runtime = new RecordingRuntime('## ChatGPT explanation');
	const provider = new ChatGptProvider({ apiKey: 'sk-test', runtime });

	const result = await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(provider.model, 'gpt-4o-mini');
	assert.equal(provider.timeoutMs, 300_000);
	assert.equal(result.markdown, '## ChatGPT explanation');
	assert.equal(runtime.calls[0].apiKey, 'sk-test');
	assert.equal(runtime.calls[0].model, 'gpt-4o-mini');
	assert.equal(runtime.calls[0].timeoutMs, 300_000);
	assert.match(runtime.calls[0].prompt, /Explain the selected code/i);
	assert.match(runtime.calls[0].prompt, /const value = 1;/);
});

test('ChatGptProvider annotateRange parses JSON and uses annotation timeout', async () => {
	const runtime = new RecordingRuntime(JSON.stringify({
		annotations: [
			{
				line: 1,
				text: 'second reuses first in the addition',
				severity: 'info',
			},
		],
	}));
	const provider = new ChatGptProvider({
		apiKey: 'sk-test',
		model: 'gpt-test-mini',
		annotationTimeoutMs: 12_345,
		runtime,
	});

	const result = await provider.annotateRange({
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
	assert.equal(result.telemetry?.provider, 'chatgpt');
	assert.equal(result.telemetry?.model, 'gpt-test-mini');
	assert.equal(runtime.calls[0].timeoutMs, 12_345);
	assert.match(runtime.calls[0].prompt, /Candidate lines to annotate/i);
	assert.match(runtime.calls[0].prompt, /1\| const second = first \+ 1;/);
});

test('ChatGptProvider reads API key from provider environment', async () => {
	const runtime = new RecordingRuntime('## From env');
	const provider = new ChatGptProvider({
		env: { VANTAGE_CHATGPT_API_KEY: 'sk-vantage-env', OPENAI_API_KEY: 'sk-openai-env' },
		runtime,
	});

	await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(runtime.calls[0].apiKey, 'sk-vantage-env');
});

test('ChatGptProvider requires an OpenAI API key before making a request', async () => {
	const provider = new ChatGptProvider({ env: {}, runtime: new RecordingRuntime('unused') });

	await assert.rejects(
		() =>
			provider.reviewCurrentHunk({
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const value = 1;',
				cursor: { line: 0, character: 0 },
				hunkText: 'const value = 1;',
			}),
		/ChatGPT provider requires VANTAGE_CHATGPT_API_KEY or OPENAI_API_KEY/
	);
});

test('ChatGptProvider writes prompt and raw response traces when configured', async () => {
	const traceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-chatgpt-trace-'));
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
		const provider = new ChatGptProvider({
			apiKey: 'sk-test',
			tracePromptPath,
			traceResponsePath,
			runtime: new RecordingRuntime(rawResponse),
		});

		await provider.annotateRange({
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

test('OpenAiSdkRuntime calls the official OpenAI Responses SDK and extracts output text', async () => {
	const createCalls: unknown[] = [];
	const runtime = new OpenAiSdkRuntime(() => ({
		responses: {
			create: async (body: unknown) => {
				createCalls.push(body);
				return { output_text: '## SDK explanation' };
			},
		},
	}));

	const result = await runtime.generate('Explain this', {
		apiKey: 'sk-test',
		model: 'gpt-4o-mini',
		timeoutMs: 300_000,
		maxTokens: 512,
		temperature: 0.1,
	});

	assert.equal(result, '## SDK explanation');
	assert.deepEqual(createCalls[0], {
		model: 'gpt-4o-mini',
		input: 'Explain this',
		max_output_tokens: 512,
		temperature: 0.1,
		store: false,
	});
});
