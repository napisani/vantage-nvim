import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { OllamaProvider } from './ollama-provider';

interface CapturedRequest {
	url: string;
	body: Record<string, unknown>;
}

function installFetchMock(status: number, responseBody: Record<string, unknown>): {
	requests: CapturedRequest[];
	restore: () => void;
} {
	const originalFetch = globalThis.fetch;
	const requests: CapturedRequest[] = [];
	globalThis.fetch = async (input, init) => {
		requests.push({
			url: String(input),
			body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
		});

		return new Response(JSON.stringify(responseBody), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	};

	return {
		requests,
		restore: () => {
			globalThis.fetch = originalFetch;
		},
	};
}

test('OllamaProvider explainSelection uses qwen3:1.7b by default', async () => {
	const fetchMock = installFetchMock(200, {
		done: true,
		message: { role: 'assistant', content: '## Ollama explanation' },
	});
	try {
		const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11435' });

		const result = await provider.explainSelection({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 0, character: 0 },
			selectedText: 'const value = 1;',
		});

		assert.equal(provider.model, 'qwen3:1.7b');
		assert.equal(result.markdown, '## Ollama explanation');
		assert.equal(fetchMock.requests[0].url, 'http://127.0.0.1:11435/api/chat');
		assert.equal(fetchMock.requests[0].body.model, 'qwen3:1.7b');
		assert.equal(fetchMock.requests[0].body.stream, false);
		assert.equal(fetchMock.requests[0].body.think, false);
		assert.equal(fetchMock.requests[0].body.keep_alive, '10m');
		assert.match(JSON.stringify(fetchMock.requests[0].body.messages), /Explain the selected code/i);
	} finally {
		fetchMock.restore();
	}
});

test('OllamaProvider annotateRange uses fast candidate-line JSON and annotation timeout', async () => {
	const fetchMock = installFetchMock(200, {
		done: true,
		total_duration: 1_500_000_000,
		prompt_eval_count: 80,
		eval_count: 24,
		message: {
			role: 'assistant',
			content: JSON.stringify({
				annotations: [
					{
						line: 1,
						text: 'second reuses first in the addition',
						severity: 'info',
					},
				],
			}),
		},
		});
	try {
		const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11435', annotationTimeoutMs: 12_345 });

		const result = await provider.annotateRange({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const first = 1;\nconst second = first + 1;',
			cursor: { line: 40, character: 0 },
			visibleRange: { startLine: 40, startCharacter: 0, endLine: 41, endCharacter: 25 },
			scopeText: 'const first = 1;\nconst second = first + 1;',
			maxAnnotations: 5,
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
		assert.equal(result.telemetry?.provider, 'ollama');
		assert.equal(result.telemetry?.model, 'qwen3:1.7b');
		assert.equal(result.telemetry?.totalDurationMs, 1500);
		assert.equal(result.telemetry?.promptEvalCount, 80);
		assert.equal(result.telemetry?.evalCount, 24);
		assert.equal(typeof fetchMock.requests[0].body.format, 'object');
		assert.equal((fetchMock.requests[0].body.format as { properties?: { annotations?: { maxItems?: number } } })
			.properties?.annotations?.maxItems, 5);
		assert.equal(fetchMock.requests[0].body.think, false);
		assert.deepEqual(fetchMock.requests[0].body.options, { num_predict: 256, temperature: 0.1 });
		const messages = JSON.stringify(fetchMock.requests[0].body.messages);
		assert.match(messages, /Candidate lines to annotate/i);
		assert.match(messages, /0\| const first = 1;/);
		assert.doesNotMatch(messages, /Numbered code to annotate/i);
	} finally {
		fetchMock.restore();
	}
});

test('OllamaProvider annotateRange uses range JSON for full-scope annotation prompts', async () => {
	const fetchMock = installFetchMock(200, {
		done: true,
		message: {
			role: 'assistant',
			content: JSON.stringify({
				annotations: [
					{
						range: { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 23 },
						text: 'third depends on the accumulated value from second',
						severity: 'info',
					},
				],
			}),
		},
	});
	try {
		const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11435' });

		const result = await provider.annotateRange({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const first = 1;\nconst second = first + 1;\nconst third = second + 1;\nreturn third;',
			cursor: { line: 40, character: 0 },
			visibleRange: { startLine: 40, startCharacter: 0, endLine: 43, endCharacter: 13 },
			scopeText: 'const first = 1;\nconst second = first + 1;\nconst third = second + 1;\nreturn third;',
			maxAnnotations: 2,
		});

		assert.deepEqual(result.annotations[0].range, {
			startLine: 42,
			startCharacter: 0,
			endLine: 42,
			endCharacter: 23,
		});
		const format = fetchMock.requests[0].body.format as {
			properties?: { annotations?: { items?: { required?: string[]; properties?: Record<string, unknown> } } };
		};
		const item = format.properties?.annotations?.items;
		assert.deepEqual(item?.required, ['range', 'text', 'severity']);
		assert.equal(item?.properties?.line, undefined);
		assert.equal(typeof item?.properties?.range, 'object');
		const messages = JSON.stringify(fetchMock.requests[0].body.messages);
		assert.match(messages, /Numbered code to annotate/i);
		assert.doesNotMatch(messages, /Candidate lines to annotate/i);
	} finally {
		fetchMock.restore();
	}
});

test('OllamaProvider cancels annotateRange with an abort signal', async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, init) =>
		new Promise<Response>((_resolve, reject) => {
			if (init?.signal?.aborted) {
				reject(new DOMException('aborted', 'AbortError'));
				return;
			}
			init?.signal?.addEventListener('abort', () => {
				reject(new DOMException('aborted', 'AbortError'));
			});
		});

	try {
		const provider = new OllamaProvider({ annotationTimeoutMs: 60_000 });
		const controller = new AbortController();
		const pending = provider.annotateRange(
			{
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const value = 1;',
				cursor: { line: 0, character: 0 },
				scopeText: 'const value = 1;',
				candidateLines: [{ line: 0, text: 'const value = 1;' }],
			},
			{ signal: controller.signal }
		);

		controller.abort();
		await assert.rejects(() => pending, /Ollama request cancelled/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('OllamaProvider reports non-200 responses', async () => {
	const fetchMock = installFetchMock(500, { error: 'model failed' });
	try {
		const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11435' });

		await assert.rejects(
			() =>
				provider.reviewCurrentHunk({
					filePath: '/repo/example.ts',
					language: 'typescript',
					text: 'const value = 1;',
					cursor: { line: 0, character: 0 },
					hunkText: 'const value = 1;',
				}),
			/Ollama request failed with status 500: model failed/
		);
	} finally {
		fetchMock.restore();
	}
});
