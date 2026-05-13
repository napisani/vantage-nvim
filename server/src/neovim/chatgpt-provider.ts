import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import OpenAI from 'openai';
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

export interface ChatGptProviderOptions {
	apiKey?: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	annotationTimeoutMs?: number;
	tracePromptPath?: string;
	traceResponsePath?: string;
	runtime?: ChatGptRuntime;
}

export interface ChatGptGenerateOptions {
	apiKey: string;
	model: string;
	timeoutMs: number;
	maxTokens: number;
	temperature: number;
	signal?: AbortSignal;
}

export interface ChatGptRuntime {
	generate(prompt: string, options: ChatGptGenerateOptions): Promise<string>;
}

export interface OpenAiResponsesClient {
	responses: {
		create(body: OpenAiResponsesCreateBody, options?: OpenAiRequestOptions): Promise<unknown>;
	};
}

export interface OpenAiResponsesCreateBody {
	model: string;
	input: string;
	max_output_tokens: number;
	temperature: number;
	store: false;
}

export interface OpenAiRequestOptions {
	timeout?: number;
	signal?: AbortSignal;
}

export type OpenAiClientFactory = (apiKey: string) => OpenAiResponsesClient;

interface RunChatGptOptions {
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

interface RunChatGptResult {
	content: string;
	telemetry: {
		provider: 'chatgpt';
		model: string;
		promptChars: number;
		promptLines: number;
		elapsedMs: number;
	};
}

export class ChatGptProvider implements BackendProvider {
	readonly model: string;
	readonly timeoutMs: number;
	readonly annotationTimeoutMs: number;
	readonly tracePromptPath?: string;
	readonly traceResponsePath?: string;
	private readonly apiKey?: string;
	private readonly runtime: ChatGptRuntime;

	constructor(options: ChatGptProviderOptions = {}) {
		const env = options.env ?? process.env;
		this.apiKey = firstNonEmpty(options.apiKey, env.LEARN_CHATGPT_API_KEY, env.OPENAI_API_KEY);
		this.model = options.model ?? 'gpt-4o-mini';
		this.timeoutMs = options.timeoutMs ?? 300_000;
		this.annotationTimeoutMs = options.annotationTimeoutMs ?? 30_000;
		this.tracePromptPath = options.tracePromptPath;
		this.traceResponsePath = options.traceResponsePath;
		this.runtime = options.runtime ?? new OpenAiSdkRuntime();
	}

	async explainSelection(params: ExplainSelectionParams, context: ProviderRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runChatGpt(buildExplainPrompt(params), { signal: context.signal });
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async annotateRange(params: AnnotateRangeParams, context: ProviderRequestContext = {}): Promise<AnnotationResult> {
		const { content, telemetry } = await this.runChatGpt(buildAnnotationPrompt(params), {
			maxTokens: 256,
			timeoutMs: this.annotationTimeoutMs,
			signal: context.signal,
		});
		return {
			kind: 'annotations',
			annotations: parseAnnotationResponse(content, annotationLineOffset(params), 'ChatGPT', params.candidateLines),
			telemetry,
		};
	}

	async reviewCurrentHunk(params: ReviewCurrentHunkParams, context: ProviderRequestContext = {}): Promise<ReviewResult> {
		const { content: markdown } = await this.runChatGpt(buildReviewPrompt(params), { signal: context.signal });
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	private async runChatGpt(prompt: string, options: RunChatGptOptions = {}): Promise<RunChatGptResult> {
		const apiKey = requireApiKey(this.apiKey);
		await writeOptionalTrace(this.tracePromptPath, prompt);
		const startedAt = Date.now();
		const content = await this.runtime.generate(prompt, {
			apiKey,
			model: this.model,
			timeoutMs: options.timeoutMs ?? this.timeoutMs,
			maxTokens: options.maxTokens ?? 1024,
			temperature: 0.1,
			signal: options.signal,
		});

		if (content.trim().length === 0) {
			throw new Error('ChatGPT produced an empty response.');
		}

		await writeOptionalTrace(this.traceResponsePath, content);
		return {
			content: content.trim(),
			telemetry: {
				provider: 'chatgpt',
				model: this.model,
				promptChars: prompt.length,
				promptLines: prompt.split('\n').length,
				elapsedMs: Date.now() - startedAt,
			},
		};
	}
}

export class OpenAiSdkRuntime implements ChatGptRuntime {
	constructor(private readonly createClient: OpenAiClientFactory = createOpenAiClient) {}

	async generate(prompt: string, options: ChatGptGenerateOptions): Promise<string> {
		const client = this.createClient(options.apiKey);
		const response = await client.responses.create({
			model: options.model,
			input: prompt,
			max_output_tokens: options.maxTokens,
			temperature: options.temperature,
			store: false,
		}, {
			timeout: options.timeoutMs,
			signal: options.signal,
		});

		return extractResponseText(response);
	}
}

function createOpenAiClient(apiKey: string): OpenAiResponsesClient {
	return new OpenAI({ apiKey }) as OpenAiResponsesClient;
}

function extractResponseText(response: unknown): string {
	if (isRecord(response) && typeof response.output_text === 'string') {
		return response.output_text;
	}

	const nestedText = extractNestedOutputText(response);
	if (nestedText) {
		return nestedText;
	}

	throw new Error('ChatGPT provider returned an unexpected response shape.');
}

function extractNestedOutputText(response: unknown): string | undefined {
	if (!isRecord(response) || !Array.isArray(response.output)) {
		return undefined;
	}

	const parts: string[] = [];
	for (const output of response.output) {
		if (!isRecord(output) || !Array.isArray(output.content)) {
			continue;
		}

		for (const item of output.content) {
			if (isRecord(item) && item.type === 'output_text' && typeof item.text === 'string') {
				parts.push(item.text);
			}
		}
	}

	const text = parts.join('\n').trim();
	return text.length > 0 ? text : undefined;
}

function requireApiKey(value: string | undefined): string {
	const apiKey = firstNonEmpty(value);
	if (!apiKey) {
		throw new Error('ChatGPT provider requires LEARN_CHATGPT_API_KEY or OPENAI_API_KEY.');
	}

	return apiKey;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
	return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function writeOptionalTrace(filePath: string | undefined, content: string): Promise<void> {
	if (!filePath || filePath.trim() === '') {
		return;
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, 'utf8');
}
