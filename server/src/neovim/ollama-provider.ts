import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	AnnotateRangeParams,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';
import type { BackendProvider, ProviderRequestContext } from './provider';
import {
	annotationLineOffset,
	buildAnnotationPrompt,
	buildExplainPrompt,
	buildReviewPrompt,
	parseAnnotationResponse,
} from './model-contract';

export interface OllamaProviderOptions {
	baseUrl?: string;
	model?: string;
	timeoutMs?: number;
	annotationTimeoutMs?: number;
	tracePromptPath?: string;
	traceResponsePath?: string;
}

interface OllamaChatResponse {
	message?: {
		content?: string;
	};
	error?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	eval_count?: number;
}

interface RunOllamaOptions {
	format?: 'annotation-json';
	annotationResponseShape?: 'line' | 'range';
	think?: boolean;
	numPredict?: number;
	maxAnnotations?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

interface RunOllamaResult {
	content: string;
	telemetry: {
		provider: 'ollama';
		model: string;
		promptChars: number;
		promptLines: number;
		elapsedMs: number;
		totalDurationMs?: number;
		promptEvalCount?: number;
		evalCount?: number;
	};
}

export class OllamaProvider implements BackendProvider {
	readonly baseUrl: string;
	readonly model: string;
	readonly timeoutMs: number;
	readonly annotationTimeoutMs: number;
	readonly tracePromptPath?: string;
	readonly traceResponsePath?: string;

	constructor(options: OllamaProviderOptions = {}) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'http://localhost:11434');
		this.model = options.model ?? 'qwen3:1.7b';
		this.timeoutMs = options.timeoutMs ?? 60_000;
		this.annotationTimeoutMs = options.annotationTimeoutMs ?? 20_000;
		this.tracePromptPath = options.tracePromptPath;
		this.traceResponsePath = options.traceResponsePath;
	}

	async explainSelection(params: ExplainSelectionParams, context: ProviderRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runOllama(buildExplainPrompt(params), { signal: context.signal });
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async annotateRange(params: AnnotateRangeParams, context: ProviderRequestContext = {}): Promise<AnnotationResult> {
		const { content, telemetry } = await this.runOllama(buildAnnotationPrompt(params), {
			format: 'annotation-json',
			think: false,
			numPredict: 256,
			maxAnnotations: params.maxAnnotations,
			annotationResponseShape: params.candidateLines && params.candidateLines.length > 0 ? 'line' : 'range',
			timeoutMs: this.annotationTimeoutMs,
			signal: context.signal,
		});
		return {
			kind: 'annotations',
			annotations: parseAnnotationResponse(content, annotationLineOffset(params), 'Ollama', params.candidateLines),
			telemetry,
		};
	}

	async reviewCurrentHunk(params: ReviewCurrentHunkParams, context: ProviderRequestContext = {}): Promise<ReviewResult> {
		const { content: markdown } = await this.runOllama(buildReviewPrompt(params), { signal: context.signal });
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	private async runOllama(prompt: string, options: RunOllamaOptions = {}): Promise<RunOllamaResult> {
		await writeOptionalTrace(this.tracePromptPath, prompt);
		const startedAt = Date.now();
		const response = await postJsonWithTimeout(`${this.baseUrl}/api/chat`, {
			model: this.model,
			messages: [{ role: 'user', content: prompt }],
			stream: false,
			think: options.think ?? false,
			keep_alive: '10m',
			...(options.format === 'annotation-json'
				? { format: annotationResponseSchema(options.maxAnnotations, options.annotationResponseShape) }
				: {}),
			options: {
				num_predict: options.numPredict ?? 1024,
				temperature: 0.1,
			},
		}, options.timeoutMs ?? this.timeoutMs, options.signal);

		const content = response.message?.content;
		if (typeof content !== 'string' || content.trim().length === 0) {
			throw new Error('Ollama produced an empty response.');
		}

		await writeOptionalTrace(this.traceResponsePath, content);
		return {
			content: content.trim(),
			telemetry: {
				provider: 'ollama',
				model: this.model,
				promptChars: prompt.length,
				promptLines: prompt.split('\n').length,
				elapsedMs: Date.now() - startedAt,
				totalDurationMs: durationToMs(response.total_duration),
				promptEvalCount: response.prompt_eval_count,
				evalCount: response.eval_count,
			},
		};
	}
}

function annotationResponseSchema(maxAnnotations = 3, shape: 'line' | 'range' = 'line'): Record<string, unknown> {
	const locationProperties = shape === 'line'
		? {
			line: { type: 'integer', minimum: 0 },
		}
		: {
			range: {
				type: 'object',
				properties: {
					startLine: { type: 'integer', minimum: 0 },
					startCharacter: { type: 'integer', minimum: 0 },
					endLine: { type: 'integer', minimum: 0 },
					endCharacter: { type: 'integer', minimum: 0 },
				},
				required: ['startLine', 'startCharacter', 'endLine', 'endCharacter'],
			},
		};

	return {
		type: 'object',
		properties: {
			annotations: {
				type: 'array',
				maxItems: maxAnnotations,
				items: {
					type: 'object',
					properties: {
						...locationProperties,
						text: {
							type: 'string',
							description: 'A short explanatory sentence that includes a literal token from the annotated code line.',
						},
						severity: { type: 'string', enum: ['info', 'warning'] },
						detailMarkdown: { type: 'string' },
					},
					required: [shape, 'text', 'severity'],
				},
			},
		},
		required: ['annotations'],
	};
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

async function postJsonWithTimeout(
	url: string,
	body: Record<string, unknown>,
	timeoutMs: number,
	externalSignal?: AbortSignal
): Promise<OllamaChatResponse> {
	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	const abort = (): void => {
		controller.abort();
	};
	if (externalSignal?.aborted) {
		controller.abort();
	}
	externalSignal?.addEventListener('abort', abort, { once: true });

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		const text = await response.text();

		if (!response.ok) {
			throw new Error(`Ollama request failed with status ${response.status}: ${responseErrorDetail(text)}`);
		}

		return parseOllamaResponse(text);
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			if (externalSignal?.aborted && !timedOut) {
				throw new Error('Ollama request cancelled.');
			}
			throw new Error(`Ollama request timed out after ${timeoutMs}ms.`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		externalSignal?.removeEventListener('abort', abort);
	}
}

function durationToMs(value: number | undefined): number | undefined {
	if (typeof value !== 'number') {
		return undefined;
	}
	return Math.round(value / 1_000_000);
}

function parseOllamaResponse(text: string): OllamaChatResponse {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('response was not an object');
		}
		return parsed as OllamaChatResponse;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Ollama response was not valid JSON: ${message}`);
	}
}

function responseErrorDetail(text: string): string {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'error' in parsed) {
			const error = (parsed as { error?: unknown }).error;
			if (typeof error === 'string' && error.trim().length > 0) {
				return error;
			}
		}
	} catch {
		// Fall back to raw text below.
	}

	return text.trim() || 'unknown error';
}

async function writeOptionalTrace(filePath: string | undefined, content: string): Promise<void> {
	if (!filePath || filePath.trim() === '') {
		return;
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, 'utf8');
}
