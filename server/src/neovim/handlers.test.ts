import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { handleBackendRequest } from './handlers';
import type { BackendProvider } from './provider';

test('handleBackendRequest returns a fake explanation', async () => {
	const response = await handleBackendRequest({
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

	assert.equal(response.id, 'req-1');
	assert.ok(response.ok);
	if (!response.ok) {
		assert.fail('expected successful response');
	}
	assert.equal(response.result.kind, 'explanation');
	assert.match(response.result.markdown, /Fake provider/);
	assert.match(response.result.markdown, /Fake provider response for \*\*elixir\*\*\./);
});

test('handleBackendRequest returns capped annotations', async () => {
	const response = await handleBackendRequest({
		id: 'req-2',
		method: 'annotateRange',
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;',
			cursor: { line: 0, character: 0 },
			visibleRange: { startLine: 0, startCharacter: 0, endLine: 3, endCharacter: 15 },
			scopeText: 'const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;',
			maxAnnotations: 4,
			lens: { mode: 'review', text: 'Check naming clarity' },
		},
	});

	assert.ok(response.ok);
	if (!response.ok) {
		assert.fail('expected successful response');
	}
	assert.equal(response.result.kind, 'annotations');
	assert.equal(response.result.annotations.length, 4);
	assert.equal(response.result.annotations[0].range.startLine, 0);
	assert.match(response.result.annotations[0].text, /Fake provider annotation/);
	assert.match(response.result.annotations[0].detailMarkdown ?? '', /Annotation detail/);
});

test('handleBackendRequest can use an injected provider', async () => {
	const provider: BackendProvider = {
		explainSelection: () => ({ kind: 'explanation', markdown: 'Injected explanation' }),
		annotateRange: () => ({ kind: 'annotations', annotations: [] }),
		reviewCurrentHunk: () => ({ kind: 'review', markdown: 'Injected review', findings: [] }),
	};

	const response = await handleBackendRequest(
		{
			id: 'req-injected',
			method: 'explainSelection',
			params: {
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const value = 1;',
				cursor: { line: 0, character: 0 },
				selectedText: 'const value = 1;',
			},
		},
		provider
	);

	assert.equal(response.id, 'req-injected');
	assert.ok(response.ok);
	if (!response.ok) {
		assert.fail('expected successful response');
	}
	assert.equal(response.result.kind, 'explanation');
	assert.equal(response.result.markdown, 'Injected explanation');
});
