import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { ChatGptProvider } from './chatgpt-provider';
import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
import { OllamaProvider } from './ollama-provider';
import { PiProvider } from './pi-provider';
import { createProviderFromConfig } from './provider-factory';

test('createProviderFromConfig defaults to fake provider', () => {
	const provider = createProviderFromConfig();

	assert.ok(provider instanceof FakeProvider);
});

test('createProviderFromConfig selects fake provider explicitly', () => {
	const provider = createProviderFromConfig({ name: 'fake' });

	assert.ok(provider instanceof FakeProvider);
});

test('createProviderFromConfig selects Codex provider with defaults', () => {
	const provider = createProviderFromConfig({ name: 'codex' });

	assert.ok(provider instanceof CodexProvider);
	assert.equal(provider.model, 'gpt-5.4-mini');
	assert.equal(provider.command, 'codex');
});

test('createProviderFromConfig passes Codex overrides', () => {
	const provider = createProviderFromConfig({
		name: 'codex',
		codex: {
			command: '/custom/codex',
			model: 'gpt-5.4-mini-test',
			timeout_ms: 900000,
			annotation_timeout_ms: 45000,
			trace_prompt_path: '/tmp/prompt.txt',
			trace_response_path: '/tmp/response.txt',
		},
	});

	assert.ok(provider instanceof CodexProvider);
	assert.equal(provider.model, 'gpt-5.4-mini-test');
	assert.equal(provider.command, '/custom/codex');
	assert.equal(provider.timeoutMs, 900_000);
	assert.equal(provider.annotationTimeoutMs, 45_000);
	assert.equal(provider.tracePromptPath, '/tmp/prompt.txt');
	assert.equal(provider.traceResponsePath, '/tmp/response.txt');
});

test('createProviderFromConfig selects Ollama provider with recommended default model', () => {
	const provider = createProviderFromConfig({ name: 'ollama' });

	assert.ok(provider instanceof OllamaProvider);
	assert.equal(provider.model, 'qwen3:1.7b');
	assert.equal(provider.baseUrl, 'http://localhost:11434');
});

test('createProviderFromConfig passes Ollama overrides', () => {
	const provider = createProviderFromConfig({
		name: 'ollama',
		ollama: {
			base_url: 'http://127.0.0.1:11435',
			model: 'qwen3-coder:30b',
			timeout_ms: 120000,
			annotation_timeout_ms: 15000,
			trace_prompt_path: '/tmp/ollama-prompt.txt',
			trace_response_path: '/tmp/ollama-response.txt',
		},
	});

	assert.ok(provider instanceof OllamaProvider);
	assert.equal(provider.baseUrl, 'http://127.0.0.1:11435');
	assert.equal(provider.model, 'qwen3-coder:30b');
	assert.equal(provider.timeoutMs, 120_000);
	assert.equal(provider.annotationTimeoutMs, 15_000);
	assert.equal(provider.tracePromptPath, '/tmp/ollama-prompt.txt');
	assert.equal(provider.traceResponsePath, '/tmp/ollama-response.txt');
});

test('createProviderFromConfig selects ChatGPT provider with configured API key', () => {
	const provider = createProviderFromConfig({
		name: 'chatgpt',
		chatgpt: {
			api_key: 'sk-config',
			model: 'gpt-test-mini',
			timeout_ms: 900000,
			annotation_timeout_ms: 45000,
			trace_prompt_path: '/tmp/chatgpt-prompt.txt',
			trace_response_path: '/tmp/chatgpt-response.txt',
		},
	});

	assert.ok(provider instanceof ChatGptProvider);
	assert.equal(provider.model, 'gpt-test-mini');
	assert.equal(provider.timeoutMs, 900_000);
	assert.equal(provider.annotationTimeoutMs, 45_000);
	assert.equal(provider.tracePromptPath, '/tmp/chatgpt-prompt.txt');
	assert.equal(provider.traceResponsePath, '/tmp/chatgpt-response.txt');
});

test('createProviderFromConfig lets ChatGPT fall back to OPENAI_API_KEY', () => {
	const provider = createProviderFromConfig({ name: 'chatgpt' }, { OPENAI_API_KEY: 'sk-openai' });

	assert.ok(provider instanceof ChatGptProvider);
});

test('createProviderFromConfig selects Pi provider with configured API key', () => {
	const provider = createProviderFromConfig({
		name: 'pi',
		pi: {
			api_key: 'sk-config',
			provider: 'anthropic',
			model: 'claude-test',
			timeout_ms: 900000,
			annotation_timeout_ms: 45000,
			trace_prompt_path: '/tmp/pi-prompt.txt',
			trace_response_path: '/tmp/pi-response.txt',
		},
	});

	assert.ok(provider instanceof PiProvider);
	assert.equal(provider.provider, 'anthropic');
	assert.equal(provider.model, 'claude-test');
	assert.equal(provider.timeoutMs, 900_000);
	assert.equal(provider.annotationTimeoutMs, 45_000);
	assert.equal(provider.tracePromptPath, '/tmp/pi-prompt.txt');
	assert.equal(provider.traceResponsePath, '/tmp/pi-response.txt');
});

test('createProviderFromConfig lets Pi fallback to standard provider API env vars', () => {
	const openai = createProviderFromConfig({ name: 'pi', pi: { provider: 'openai' } }, { OPENAI_API_KEY: 'sk-openai' });
	const anthropic = createProviderFromConfig(
		{ name: 'pi', pi: { provider: 'anthropic' } },
		{ ANTHROPIC_API_KEY: 'sk-ant' }
	);

	assert.ok(openai instanceof PiProvider);
	assert.ok(anthropic instanceof PiProvider);
});

test('createProviderFromConfig rejects unknown providers', () => {
	assert.throws(
		() => createProviderFromConfig({ name: 'llama' as never }),
		/Unsupported provider "llama".*pi/
	);
});
