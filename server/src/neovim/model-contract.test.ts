import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { buildAnnotationPrompt } from './model-contract';

test('buildAnnotationPrompt uses the requested annotation budget', () => {
	const prompt = buildAnnotationPrompt({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const one = 1;\nconst two = one + 1;',
		cursor: { line: 0, character: 0 },
		visibleRange: { startLine: 0, startCharacter: 0, endLine: 1, endCharacter: 20 },
		scopeText: 'const one = 1;\nconst two = one + 1;',
		maxAnnotations: 5,
		candidateLines: [
			{ line: 0, text: 'const one = 1;' },
			{ line: 1, text: 'const two = one + 1;' },
		],
	});

	assert.match(prompt, /Return at most 5 annotations/);
	assert.doesNotMatch(prompt, /Return at most 3 annotations/);
});
