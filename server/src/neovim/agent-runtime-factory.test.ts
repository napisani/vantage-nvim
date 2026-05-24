import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { createAgentRuntimeFromConfig } from './agent-runtime-factory';
import { DevelopmentAgentRuntime } from './development-agent-runtime';
import { PiAgentRuntime } from './pi-agent-runtime';

test('createAgentRuntimeFromConfig defaults to Pi openai/gpt-4o-mini', () => {
	const runtime = createAgentRuntimeFromConfig();

	assert.ok(runtime instanceof PiAgentRuntime);
	assert.equal(runtime.provider, 'openai');
	assert.equal(runtime.model, 'gpt-4o-mini');
	assert.equal(runtime.options.temperature, 0.1);
	assert.equal(runtime.options.maxTokens, 1024);
	assert.equal(runtime.options.timeoutMs, 300_000);
	assert.deepEqual(runtime.session, {
		enabled: true,
		max_turns: 12,
		cacheRetention: 'short',
	});
});

test('createAgentRuntimeFromConfig passes model target, agent options, command options, and trace paths', () => {
	const runtime = createAgentRuntimeFromConfig({
		agent: {
			provider: 'anthropic',
			model: 'claude-sonnet-test',
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
			annotate: {
				options: {
					maxTokens: 128,
					timeoutMs: 12_345,
				},
			},
		},
	});

	assert.ok(runtime instanceof PiAgentRuntime);
	assert.equal(runtime.provider, 'anthropic');
	assert.equal(runtime.model, 'claude-sonnet-test');
	assert.deepEqual(runtime.session, {
		enabled: true,
		max_turns: 8,
		cacheRetention: 'long',
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
	assert.deepEqual(runtime.commandOptions.annotate, {
		maxTokens: 128,
		timeoutMs: 12_345,
	});
	assert.equal(runtime.tracePromptPath, '/tmp/pi-prompt.txt');
	assert.equal(runtime.traceResponsePath, '/tmp/pi-response.txt');
});

test('createAgentRuntimeFromConfig keeps development runtime internal', () => {
	const runtime = createAgentRuntimeFromConfig({
		agent: {
			runtime: 'development',
		},
	});

	assert.ok(runtime instanceof DevelopmentAgentRuntime);
});
