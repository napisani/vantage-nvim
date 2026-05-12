import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
import { OllamaProvider } from './ollama-provider';
import { createProviderFromEnv } from './provider-factory';

test('createProviderFromEnv defaults to fake provider', () => {
	const provider = createProviderFromEnv({});

	assert.ok(provider instanceof FakeProvider);
});

test('createProviderFromEnv selects fake provider explicitly', () => {
	const provider = createProviderFromEnv({ LEARN_PROVIDER: 'fake' });

	assert.ok(provider instanceof FakeProvider);
});

test('createProviderFromEnv selects Codex provider with defaults', () => {
	const provider = createProviderFromEnv({ LEARN_PROVIDER: 'codex' });

	assert.ok(provider instanceof CodexProvider);
	assert.equal(provider.model, 'gpt-5.4-mini');
	assert.equal(provider.command, 'codex');
});

test('createProviderFromEnv passes Codex command and model overrides', () => {
	const provider = createProviderFromEnv({
		LEARN_PROVIDER: 'codex',
		LEARN_CODEX_COMMAND: '/custom/codex',
		LEARN_CODEX_MODEL: 'gpt-5.4-mini-test',
		LEARN_CODEX_TIMEOUT_MS: '900000',
		LEARN_CODEX_ANNOTATION_TIMEOUT_MS: '45000',
	});

	assert.ok(provider instanceof CodexProvider);
	assert.equal(provider.model, 'gpt-5.4-mini-test');
	assert.equal(provider.command, '/custom/codex');
	assert.equal(provider.timeoutMs, 900_000);
	assert.equal(provider.annotationTimeoutMs, 45_000);
});

test('createProviderFromEnv passes Codex trace paths', () => {
	const provider = createProviderFromEnv({
		LEARN_PROVIDER: 'codex',
		LEARN_CODEX_TRACE_PROMPT_PATH: '/tmp/prompt.txt',
		LEARN_CODEX_TRACE_RESPONSE_PATH: '/tmp/response.txt',
	});

	assert.ok(provider instanceof CodexProvider);
	assert.equal(provider.tracePromptPath, '/tmp/prompt.txt');
	assert.equal(provider.traceResponsePath, '/tmp/response.txt');
});

test('createProviderFromEnv selects Ollama provider with recommended default model', () => {
	const provider = createProviderFromEnv({ LEARN_PROVIDER: 'ollama' });

	assert.ok(provider instanceof OllamaProvider);
	assert.equal(provider.model, 'qwen3:1.7b');
	assert.equal(provider.baseUrl, 'http://localhost:11434');
});

test('createProviderFromEnv passes Ollama overrides', () => {
	const provider = createProviderFromEnv({
		LEARN_PROVIDER: 'ollama',
		LEARN_OLLAMA_BASE_URL: 'http://127.0.0.1:11435',
		LEARN_OLLAMA_MODEL: 'qwen3-coder:30b',
		LEARN_OLLAMA_TIMEOUT_MS: '120000',
		LEARN_OLLAMA_ANNOTATION_TIMEOUT_MS: '15000',
		LEARN_OLLAMA_TRACE_PROMPT_PATH: '/tmp/ollama-prompt.txt',
		LEARN_OLLAMA_TRACE_RESPONSE_PATH: '/tmp/ollama-response.txt',
	});

	assert.ok(provider instanceof OllamaProvider);
	assert.equal(provider.baseUrl, 'http://127.0.0.1:11435');
	assert.equal(provider.model, 'qwen3-coder:30b');
	assert.equal(provider.timeoutMs, 120_000);
	assert.equal(provider.annotationTimeoutMs, 15_000);
	assert.equal(provider.tracePromptPath, '/tmp/ollama-prompt.txt');
	assert.equal(provider.traceResponsePath, '/tmp/ollama-response.txt');
});

test('createProviderFromEnv rejects invalid Codex timeout overrides', () => {
	assert.throws(
		() => createProviderFromEnv({ LEARN_PROVIDER: 'codex', LEARN_CODEX_TIMEOUT_MS: 'nope' }),
		/LEARN_CODEX_TIMEOUT_MS must be a positive integer/
	);
});

test('createProviderFromEnv rejects unknown providers', () => {
	assert.throws(
		() => createProviderFromEnv({ LEARN_PROVIDER: 'llama' }),
		/Unsupported provider "llama"/
	);
});
