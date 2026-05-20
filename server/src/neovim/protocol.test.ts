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
			cursor: { line: 0, character: 0 },
			selectedText: 'defmodule Example do\nend',
			lens: { mode: 'learning', text: 'I am learning Elixir syntax' },
		},
	});

	assert.equal(parsed.id, 'req-1');
	assert.equal(parsed.method, 'explainSelection');
	assert.equal(parsed.params.language, 'elixir');
	assert.equal(parsed.params.lens?.mode, 'learning');
});

test('parseBackendRequest accepts annotation candidate lines', () => {
	const parsed = parseBackendRequest({
		id: 'req-annotations',
		method: 'annotateRange',
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const one = 1;\n// comment\nconst two = one + 1;',
			cursor: { line: 2, character: 0 },
			visibleRange: { startLine: 10, startCharacter: 0, endLine: 12, endCharacter: 20 },
			scopeText: 'const one = 1;\n// comment\nconst two = one + 1;',
			maxAnnotations: 5,
			candidateLines: [
				{ line: 0, text: 'const one = 1;' },
				{ line: 2, text: 'const two = one + 1;' },
			],
		},
	});

	assert.equal(parsed.method, 'annotateRange');
	assert.equal(parsed.params.maxAnnotations, 5);
	assert.deepEqual(parsed.params.candidateLines, [
		{ line: 0, text: 'const one = 1;' },
		{ line: 2, text: 'const two = one + 1;' },
	]);
});

test('parseBackendRequest accepts explicit provider config', () => {
	const parsed = parseBackendRequest({
		id: 'req-provider-config',
		method: 'explainSelection',
		config: {
			provider: {
				name: 'pi',
				pi: {
					provider: 'anthropic',
					model: 'claude-sonnet-4',
					api_key: 'sk-config',
					timeout_ms: 900000,
					annotation_timeout_ms: 45000,
					trace_prompt_path: '/tmp/pi-prompt.txt',
					trace_response_path: '/tmp/pi-response.txt',
				},
			},
		},
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 0, character: 0 },
			selectedText: 'const value = 1;',
		},
	});

	assert.deepEqual(parsed.config?.provider, {
		name: 'pi',
		pi: {
			provider: 'anthropic',
			model: 'claude-sonnet-4',
			api_key: 'sk-config',
			timeout_ms: 900000,
			annotation_timeout_ms: 45000,
			trace_prompt_path: '/tmp/pi-prompt.txt',
			trace_response_path: '/tmp/pi-response.txt',
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
					cursor: { line: 0, character: 0 },
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
					cursor: { line: -1, character: 0 },
					selectedText: 'defmodule Example do\nend',
				},
			}),
		/params.cursor.line must be a non-negative integer/
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
					cursor: { line: 0, character: 0 },
					visibleRange: { startLine: 1.5, startCharacter: 0, endLine: 1, endCharacter: 16 },
					scopeText: 'const value = 1;',
				},
			}),
		/params.visibleRange.startLine must be a non-negative integer/
	);
});
