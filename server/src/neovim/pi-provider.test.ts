import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	PiProvider,
	PiSdkRuntime,
	type PiAssistantMessage,
	type PiCompleteOptions,
	type PiContext,
	type PiRuntime,
} from './pi-provider';

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

test('PiProvider explainSelection uses openai/gpt-4o-mini by default', async () => {
	const runtime = new RecordingRuntime('## Pi explanation');
	const provider = new PiProvider({ apiKey: 'sk-test', runtime });

	const result = await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(provider.provider, 'openai');
	assert.equal(provider.model, 'gpt-4o-mini');
	assert.equal(provider.timeoutMs, 300_000);
	assert.equal(result.markdown, '## Pi explanation');
	assert.equal(runtime.calls[0].provider, 'openai');
	assert.equal(runtime.calls[0].model, 'gpt-4o-mini');
	assert.equal(runtime.calls[0].options.apiKey, 'sk-test');
	assert.equal(runtime.calls[0].options.timeoutMs, 300_000);
	assert.equal(runtime.calls[0].options.maxTokens, 1024);
	assert.equal(runtime.calls[0].options.temperature, 0.1);
	assert.equal(runtime.calls[0].context.messages.length, 1);
	assert.equal(runtime.calls[0].context.messages[0].role, 'user');
	assert.match(String(runtime.calls[0].context.messages[0].content), /Explain the selected code/i);
	assert.match(String(runtime.calls[0].context.messages[0].content), /const value = 1;/);
});

test('PiProvider annotateRange parses JSON and uses annotation timeout', async () => {
	const runtime = new RecordingRuntime(JSON.stringify({
		annotations: [
			{
				line: 1,
				text: 'second reuses first in the addition',
				severity: 'info',
			},
		],
	}));
	const provider = new PiProvider({
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
	assert.equal(result.telemetry?.provider, 'pi');
	assert.equal(result.telemetry?.model, 'openai/gpt-test-mini');
	assert.equal(runtime.calls[0].options.timeoutMs, 12_345);
	assert.equal(runtime.calls[0].options.maxTokens, 256);
	assert.match(String(runtime.calls[0].context.messages[0].content), /Candidate lines to annotate/i);
	assert.match(String(runtime.calls[0].context.messages[0].content), /1\| const second = first \+ 1;/);
});

test('PiProvider falls back to OPENAI_API_KEY for openai provider', async () => {
	const runtime = new RecordingRuntime('## From env');
	const provider = new PiProvider({
		env: { OPENAI_API_KEY: 'sk-openai-env' },
		runtime,
	});

	await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(runtime.calls[0].options.apiKey, 'sk-openai-env');
});

test('PiProvider prefers explicit API key over provider environment keys', async () => {
	const runtime = new RecordingRuntime('## From explicit key');
	const provider = new PiProvider({
		apiKey: 'sk-explicit',
		env: { OPENAI_API_KEY: 'sk-openai-env' },
		runtime,
	});

	await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(runtime.calls[0].options.apiKey, 'sk-explicit');
});

test('PiProvider falls back to ANTHROPIC_API_KEY for anthropic provider', async () => {
	const runtime = new RecordingRuntime('## From Anthropic env');
	const provider = new PiProvider({
		provider: 'anthropic',
		env: { ANTHROPIC_API_KEY: 'sk-anthropic-env' },
		runtime,
	});

	await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(runtime.calls[0].options.apiKey, 'sk-anthropic-env');
});

test('PiProvider requires an API key before making a request', async () => {
	const runtime = new RecordingRuntime('unused');
	const provider = new PiProvider({ env: {}, runtime });

	await assert.rejects(
		() =>
			provider.reviewCurrentHunk({
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const value = 1;',
				cursor: { line: 0, character: 0 },
				hunkText: 'const value = 1;',
			}),
		/Pi provider requires config\.provider\.pi\.api_key or OPENAI_API_KEY/
	);
	assert.equal(runtime.calls.length, 0);
});

test('PiProvider writes prompt and raw response traces when configured', async () => {
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
		const provider = new PiProvider({
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

test('PiSdkRuntime reports unknown provider and model before calling the SDK completion path', async () => {
	const runtime = new PiSdkRuntime();

	await assert.rejects(
		() =>
			runtime.complete('unknown-provider', 'unknown-model', {
				messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
			}, {
				apiKey: 'sk-test',
				timeoutMs: 100,
				maxTokens: 16,
				temperature: 0.1,
			}),
		/Unknown Pi model "unknown-provider\/unknown-model"/
	);
});
