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
