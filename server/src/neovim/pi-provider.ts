import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Api, Context, KnownProvider, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
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

export interface PiProviderOptions {
	apiKey?: string;
	provider?: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	annotationTimeoutMs?: number;
	tracePromptPath?: string;
	traceResponsePath?: string;
	runtime?: PiRuntime;
}

export interface PiCompleteOptions {
	apiKey: string;
	timeoutMs: number;
	maxTokens: number;
	temperature: number;
	signal?: AbortSignal;
	reasoning?: SimpleStreamOptions['reasoning'];
}

export type PiContext = Context;

export interface PiAssistantMessage {
	role?: string;
	content: {
		type: string;
		text?: string;
	}[];
	stopReason?: string;
	errorMessage?: string;
}

export interface PiRuntime {
	complete(provider: string, model: string, context: PiContext, options: PiCompleteOptions): Promise<PiAssistantMessage>;
}

interface RunPiOptions {
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

interface RunPiResult {
	content: string;
	telemetry: {
		provider: 'pi';
		model: string;
		promptChars: number;
		promptLines: number;
		elapsedMs: number;
	};
}

export class PiProvider implements BackendProvider {
	readonly provider: string;
	readonly model: string;
	readonly timeoutMs: number;
	readonly annotationTimeoutMs: number;
	readonly tracePromptPath?: string;
	readonly traceResponsePath?: string;
	private readonly apiKey?: string;
	private readonly runtime: PiRuntime;

	constructor(options: PiProviderOptions = {}) {
		const env = options.env ?? process.env;
		this.provider = options.provider ?? 'openai';
		this.apiKey = firstNonEmpty(
			options.apiKey,
			this.provider === 'openai' ? env.OPENAI_API_KEY : undefined,
			this.provider === 'anthropic' ? env.ANTHROPIC_API_KEY : undefined
		);
		this.model = options.model ?? 'gpt-4o-mini';
		this.timeoutMs = options.timeoutMs ?? 300_000;
		this.annotationTimeoutMs = options.annotationTimeoutMs ?? 30_000;
		this.tracePromptPath = options.tracePromptPath;
		this.traceResponsePath = options.traceResponsePath;
		this.runtime = options.runtime ?? new PiSdkRuntime();
	}

	async explainSelection(params: ExplainSelectionParams, context: ProviderRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runPi(buildExplainPrompt(params), { signal: context.signal });
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async annotateRange(params: AnnotateRangeParams, context: ProviderRequestContext = {}): Promise<AnnotationResult> {
		const { content, telemetry } = await this.runPi(buildAnnotationPrompt(params), {
			maxTokens: 256,
			timeoutMs: this.annotationTimeoutMs,
			signal: context.signal,
		});
		return {
			kind: 'annotations',
			annotations: parseAnnotationResponse(content, annotationLineOffset(params), 'Pi', params.candidateLines),
			telemetry,
		};
	}

	async reviewCurrentHunk(params: ReviewCurrentHunkParams, context: ProviderRequestContext = {}): Promise<ReviewResult> {
		const { content: markdown } = await this.runPi(buildReviewPrompt(params), { signal: context.signal });
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	private async runPi(prompt: string, options: RunPiOptions = {}): Promise<RunPiResult> {
		const apiKey = requireApiKey(this.apiKey, this.provider);
		await writeOptionalTrace(this.tracePromptPath, prompt);
		const startedAt = Date.now();
		const content = extractAssistantText(await this.completeWithTimeout(
			{
				messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
			},
			{
				apiKey,
				timeoutMs: options.timeoutMs ?? this.timeoutMs,
				maxTokens: options.maxTokens ?? 1024,
				temperature: 0.1,
				signal: options.signal,
			}
		));

		if (content.trim().length === 0) {
			throw new Error('Pi produced an empty response.');
		}

		await writeOptionalTrace(this.traceResponsePath, content);
		return {
			content: content.trim(),
			telemetry: {
				provider: 'pi',
				model: `${this.provider}/${this.model}`,
				promptChars: prompt.length,
				promptLines: prompt.split('\n').length,
				elapsedMs: Date.now() - startedAt,
			},
		};
	}

	private async completeWithTimeout(context: PiContext, options: PiCompleteOptions): Promise<PiAssistantMessage> {
		const controller = new AbortController();
		const runtimeOptions = { ...options, signal: controller.signal };
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let removeAbortListener = (): void => {};

		const completion = Promise.resolve().then(() =>
			this.runtime.complete(this.provider, this.model, context, runtimeOptions)
		);
		completion.catch(() => undefined);

		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => {
				reject(new Error(`Pi request timed out after ${options.timeoutMs}ms.`));
				controller.abort();
			}, options.timeoutMs);
		});

		const abortPromise = new Promise<never>((_resolve, reject) => {
			const abort = (): void => {
				reject(new Error('Pi request cancelled.'));
				controller.abort();
			};

			if (options.signal?.aborted) {
				abort();
				return;
			}

			options.signal?.addEventListener('abort', abort, { once: true });
			removeAbortListener = (): void => {
				options.signal?.removeEventListener('abort', abort);
			};
		});

		try {
			return await Promise.race([completion, timeoutPromise, abortPromise]);
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
			removeAbortListener();
		}
	}
}

export class PiSdkRuntime implements PiRuntime {
	async complete(provider: string, model: string, context: PiContext, options: PiCompleteOptions): Promise<PiAssistantMessage> {
		const pi = await importPiAi();
		const resolvedModel = pi.getModel(provider as KnownProvider, model as never) as Model<Api> | undefined;
		if (!resolvedModel) {
			throw new Error(`Unknown Pi model "${provider}/${model}".`);
		}

		return pi.completeSimple(resolvedModel, context, options);
	}
}

async function importPiAi(): Promise<typeof import('@earendil-works/pi-ai')> {
	const dynamicImport = new Function('specifier', 'return import(specifier)') as (
		specifier: string
	) => Promise<typeof import('@earendil-works/pi-ai')>;
	return dynamicImport('@earendil-works/pi-ai');
}

function extractAssistantText(message: PiAssistantMessage): string {
	if (message.stopReason === 'error' && message.errorMessage) {
		throw new Error(`Pi provider failed: ${message.errorMessage}`);
	}

	const parts = message.content
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text?.trim() ?? '')
		.filter((text) => text.length > 0);

	if (parts.length === 0) {
		throw new Error('Pi provider returned an unexpected response shape.');
	}

	return parts.join('\n');
}

function requireApiKey(value: string | undefined, provider: string): string {
	const apiKey = firstNonEmpty(value);
	if (!apiKey) {
		if (provider === 'openai') {
			throw new Error('Pi provider requires config.provider.pi.api_key or OPENAI_API_KEY.');
		}
		if (provider === 'anthropic') {
			throw new Error('Pi provider requires config.provider.pi.api_key or ANTHROPIC_API_KEY.');
		}
		throw new Error('Pi provider requires config.provider.pi.api_key.');
	}

	return apiKey;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
	return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

async function writeOptionalTrace(filePath: string | undefined, content: string): Promise<void> {
	if (!filePath || filePath.trim() === '') {
		return;
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, 'utf8');
}
