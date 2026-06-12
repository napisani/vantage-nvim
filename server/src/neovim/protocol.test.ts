import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { parseBackendRequest } from './protocol';

test('parseBackendRequest accepts an explainSelection request', () => {
	const parsed = parseBackendRequest({
		id: 'req-1',
		method: 'explainSelection',
		params: {
			filePath: '/repo/example.ex',
			language: 'elixir',
			text: 'defmodule Example do\nend',
			cursor: { line: 1, character: 1 },
			selectedText: 'defmodule Example do\nend',
			lens: { mode: 'learning', text: 'I am learning Elixir syntax' },
		},
	});

	assert.equal(parsed.id, 'req-1');
	assert.equal(parsed.method, 'explainSelection');
	assert.equal(parsed.params.language, 'elixir');
	assert.equal(parsed.params.lens?.mode, 'learning');
});

test('parseBackendRequest accepts a questionSelection request', () => {
	const parsed = parseBackendRequest({
		id: 'req-question',
		method: 'questionSelection',
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 1, character: 1 },
			selectedText: 'const value = 1;',
			question: 'Why is this constant useful?',
		},
	});

	assert.equal(parsed.method, 'questionSelection');
	assert.equal(parsed.params.question, 'Why is this constant useful?');
	assert.equal(parsed.params.selectedText, 'const value = 1;');
});

test('parseBackendRequest accepts an editSelection request', () => {
	const parsed = parseBackendRequest({
		id: 'req-edit',
		method: 'editSelection',
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 1, character: 1 },
			range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 16 },
			selectedText: 'const value = 1;',
			instruction: 'Rename value to count.',
		},
	});

	assert.equal(parsed.method, 'editSelection');
	assert.equal(parsed.params.instruction, 'Rename value to count.');
	assert.equal(parsed.params.range.startLine, 1);
});

test('parseBackendRequest accepts a searchLocations request', () => {
	const parsed = parseBackendRequest({
		id: 'req-search',
		method: 'searchLocations',
		params: {
			workspaceRoot: '/repo',
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 1, character: 1 },
			query: 'find related factory calls',
		},
	});

	assert.equal(parsed.method, 'searchLocations');
	assert.equal(parsed.params.query, 'find related factory calls');
});

test('parseBackendRequest accepts annotation candidate lines', () => {
	const parsed = parseBackendRequest({
		id: 'req-annotations',
		method: 'annotateRange',
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const one = 1;\n// comment\nconst two = one + 1;',
			cursor: { line: 12, character: 1 },
			visibleRange: { startLine: 10, startCharacter: 1, endLine: 12, endCharacter: 20 },
			scopeText: 'const one = 1;\n// comment\nconst two = one + 1;',
			maxAnnotations: 5,
			candidateLines: [
				{ line: 10, text: 'const one = 1;' },
				{ line: 12, text: 'const two = one + 1;' },
			],
		},
	});

	assert.equal(parsed.method, 'annotateRange');
	assert.equal(parsed.params.maxAnnotations, 5);
	assert.deepEqual(parsed.params.candidateLines, [
		{ line: 10, text: 'const one = 1;' },
		{ line: 12, text: 'const two = one + 1;' },
	]);
});

test('parseBackendRequest accepts agent task context', () => {
	const parsed = parseBackendRequest({
		id: 'req-agent-context',
		method: 'explainSelection',
		params: {
			workspaceRoot: '/repo',
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 1, character: 1 },
			selectedText: 'const value = 1;',
			agentContext: {
				path: '/repo/.vantage/agent-context.md',
				content: '# Agent Task Context\n\n## Goal\nShip context',
				revision: 'rev-one',
				modifiedAt: '2026-05-21T12:00:00.000Z',
				ageMs: 1200,
				truncated: true,
			},
		},
	});

	assert.deepEqual(parsed.params.agentContext, {
		path: '/repo/.vantage/agent-context.md',
		content: '# Agent Task Context\n\n## Goal\nShip context',
		revision: 'rev-one',
		modifiedAt: '2026-05-21T12:00:00.000Z',
		ageMs: 1200,
		truncated: true,
	});
	assert.equal(parsed.params.workspaceRoot, '/repo');
});

test('parseBackendRequest accepts explicit agent and command config', () => {
	const parsed = parseBackendRequest({
		id: 'req-agent-config',
		method: 'explainSelection',
		config: {
			agent: {
				provider: 'anthropic',
				model: 'claude-sonnet-4',
				auth: {
					path: '~/.config/pi-ai/auth.json',
				},
				options: {
					apiKey: 'sk-config',
					reasoning: 'medium',
					temperature: 0.2,
					maxTokens: 2048,
					timeoutMs: 900000,
				},
			},
			commands: {
				question: {
					options: {
						maxTokens: 1536,
					},
				},
				annotate: {
					waiting_message_ms: 10,
					options: {
						maxTokens: 128,
						timeoutMs: 45000,
					},
				},
				edit: {
					options: {
						timeoutMs: 60000,
					},
				},
			},
		},
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 1, character: 1 },
			selectedText: 'const value = 1;',
		},
	});

	assert.deepEqual(parsed.config?.agent, {
		provider: 'anthropic',
		model: 'claude-sonnet-4',
		auth: {
			path: '~/.config/pi-ai/auth.json',
		},
		options: {
			apiKey: 'sk-config',
			reasoning: 'medium',
			temperature: 0.2,
			maxTokens: 2048,
			timeoutMs: 900000,
		},
	});
	assert.deepEqual(parsed.config?.commands?.annotate, {
		waiting_message_ms: 10,
		options: {
			maxTokens: 128,
			timeoutMs: 45000,
		},
	});
	assert.deepEqual(parsed.config?.commands?.question, {
		options: {
			maxTokens: 1536,
		},
	});
	assert.deepEqual(parsed.config?.commands?.edit, {
		options: {
			timeoutMs: 60000,
		},
	});
});

test('parseBackendRequest rejects invalid annotation budgets', () => {
	assert.throws(
		() =>
			parseBackendRequest({
				id: 'req-annotations',
				method: 'annotateRange',
				params: {
					filePath: '/repo/example.ts',
					language: 'typescript',
					text: 'const value = 1;',
					cursor: { line: 1, character: 1 },
					scopeText: 'const value = 1;',
					maxAnnotations: 0,
				},
			}),
		/params.maxAnnotations must be a positive integer/
	);
});

test('parseBackendRequest rejects a request without an id', () => {
	assert.throws(
		() => parseBackendRequest({ method: 'explainSelection', params: {} }),
		/request id must be a non-empty string/
	);
});

test('parseBackendRequest rejects an unknown method', () => {
	assert.throws(
		() => parseBackendRequest({ id: 'req-1', method: 'unknown', params: {} }),
		/unsupported method/
	);
});

test('parseBackendRequest rejects negative cursor coordinates', () => {
	assert.throws(
		() =>
			parseBackendRequest({
				id: 'req-1',
				method: 'explainSelection',
				params: {
					filePath: '/repo/example.ex',
					language: 'elixir',
					text: 'defmodule Example do\nend',
					cursor: { line: 0, character: 1 },
					selectedText: 'defmodule Example do\nend',
				},
			}),
		/params.cursor.line must be a positive 1-based integer/
	);
});

test('parseBackendRequest rejects floating range coordinates', () => {
	assert.throws(
		() =>
			parseBackendRequest({
				id: 'req-1',
				method: 'annotateRange',
				params: {
					filePath: '/repo/example.ts',
					language: 'typescript',
					text: 'const value = 1;',
					cursor: { line: 1, character: 1 },
					visibleRange: { startLine: 1.5, startCharacter: 1, endLine: 1, endCharacter: 16 },
					scopeText: 'const value = 1;',
				},
			}),
		/params.visibleRange.startLine must be a positive 1-based integer/
	);
});
