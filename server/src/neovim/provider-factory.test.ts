import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
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
	});

	assert.ok(provider instanceof CodexProvider);
	assert.equal(provider.model, 'gpt-5.4-mini-test');
	assert.equal(provider.command, '/custom/codex');
});

test('createProviderFromEnv rejects unknown providers', () => {
	assert.throws(
		() => createProviderFromEnv({ LEARN_PROVIDER: 'llama' }),
		/Unsupported provider "llama"/
	);
});
