import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Api, Context, KnownProvider, Model, SimpleStreamOptions, StopReason } from '@earendil-works/pi-ai';
import type {
	AgentCacheRetention,
	AgentAuthConfig,
	AgentOptionsConfig,
	AgentSessionConfig,
	AnnotateRangeParams,
	AnnotationResult,
	BaseRequestParams,
	EditResult,
	EditSelectionParams,
	ExplainSelectionParams,
	ExplanationResult,
	QuestionSelectionParams,
	ReviewCurrentHunkParams,
	ReviewResult,
	AgentRuntimeProgress,
} from './protocol';
import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import {
	annotationLineOffset,
	buildAnnotationPrompt,
	buildEditPrompt,
	buildExplainPrompt,
	buildQuestionPrompt,
	buildReviewPrompt,
	parseAnnotationResponse,
	parseEditResponse,
} from './model-contract';
import {
	AgentSessionStore,
	sessionPromptParams,
	userMessageFor,
	VantageAgentSessions,
	type AgentSessionMessage,
	type SessionState,
} from './agent-session';
import { PiOAuthCredentialResolver, type PiCredentialResolver } from './pi-oauth-auth';

export interface CommandAgentOptions {
	explain?: AgentOptionsConfig;
	question?: AgentOptionsConfig;
	edit?: AgentOptionsConfig;
	annotate?: AgentOptionsConfig;
	review?: AgentOptionsConfig;
}

export interface PiAgentRuntimeOptions {
	provider?: string;
	model?: string;
	auth?: AgentAuthConfig;
	options?: AgentOptionsConfig;
	session?: AgentSessionConfig;
	commandOptions?: CommandAgentOptions;
	tracePromptPath?: string;
	traceResponsePath?: string;
	runtime?: PiRuntime;
	credentialResolver?: PiCredentialResolver;
	sessionStore?: AgentSessionStore;
}

export interface PiCompleteOptions extends AgentOptionsConfig {
	signal?: AbortSignal;
	sessionId?: string;
	cacheRetention?: AgentCacheRetention;
}

export type PiContext = Context;

interface PiUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export interface PiAssistantMessage {
	role?: string;
	content: {
		type: string;
		text?: string;
	}[];
	api?: Api;
	provider?: string;
	model?: string;
	responseModel?: string;
	responseId?: string;
	diagnostics?: unknown[];
	usage?: PiUsage;
	stopReason?: StopReason;
	errorMessage?: string;
	timestamp?: number;
}

export interface PiRuntime {
	complete(provider: string, model: string, context: PiContext, options: PiCompleteOptions): Promise<PiAssistantMessage>;
}

interface RunPiOptions {
	command: keyof CommandAgentOptions;
	defaults: AgentOptionsConfig;
	signal?: AbortSignal;
	reportProgress?: (progress: AgentRuntimeProgress) => void;
	trimContent?: boolean;
}

interface RunPiResult {
	content: string;
	telemetry: {
		runtime: 'pi';
		model: string;
		promptChars: number;
		promptLines: number;
		elapsedMs: number;
	};
}

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_OPTIONS: Required<Pick<AgentOptionsConfig, 'maxTokens' | 'temperature' | 'timeoutMs'>> = {
	maxTokens: 1024,
	temperature: 0.1,
	timeoutMs: 300_000,
};
const DEFAULT_ANNOTATION_OPTIONS: Pick<AgentOptionsConfig, 'maxTokens' | 'timeoutMs'> = {
	maxTokens: 256,
	timeoutMs: 300_000,
};
const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

export class PiAgentRuntime implements AgentRuntime {
	readonly provider: string;
	readonly model: string;
	readonly auth?: AgentAuthConfig;
	readonly options: AgentOptionsConfig;
	readonly session: Required<AgentSessionConfig>;
	readonly commandOptions: CommandAgentOptions;
	readonly tracePromptPath?: string;
	readonly traceResponsePath?: string;
	private readonly runtime: PiRuntime;
	private readonly credentialResolver: PiCredentialResolver;
	private readonly sessions: VantageAgentSessions;

	constructor(options: PiAgentRuntimeOptions = {}) {
		this.provider = options.provider ?? DEFAULT_PROVIDER;
		this.model = options.model ?? DEFAULT_MODEL;
		this.auth = options.auth;
		this.options = { ...DEFAULT_OPTIONS, ...(options.options ?? {}) };
		this.sessions = new VantageAgentSessions(options.session, options.sessionStore ?? new AgentSessionStore());
		this.session = this.sessions.config;
		this.commandOptions = options.commandOptions ?? {};
		this.tracePromptPath = options.tracePromptPath;
		this.traceResponsePath = options.traceResponsePath;
		this.runtime = options.runtime ?? new PiSdkRuntime();
		this.credentialResolver = options.credentialResolver ?? new PiOAuthCredentialResolver();
	}

	async explainSelection(params: ExplainSelectionParams, context: AgentRuntimeRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runPi(params, buildExplainPrompt(sessionPromptParams(params, this.session.enabled)), {
			command: 'explain',
			defaults: {},
			signal: context.signal,
			reportProgress: context.reportProgress,
		});
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async questionSelection(params: QuestionSelectionParams, context: AgentRuntimeRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runPi(params, buildQuestionPrompt(sessionPromptParams(params, this.session.enabled)), {
			command: 'question',
			defaults: {},
			signal: context.signal,
			reportProgress: context.reportProgress,
		});
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async editSelection(params: EditSelectionParams, context: AgentRuntimeRequestContext = {}): Promise<EditResult> {
		const { content, telemetry } = await this.runPi(params, buildEditPrompt(sessionPromptParams(params, this.session.enabled)), {
			command: 'edit',
			defaults: {},
			signal: context.signal,
			reportProgress: context.reportProgress,
			trimContent: false,
		});
		return {
			kind: 'edit',
			replacementText: parseEditResponse(content),
			telemetry,
		};
	}

	async annotateRange(params: AnnotateRangeParams, context: AgentRuntimeRequestContext = {}): Promise<AnnotationResult> {
		const { content, telemetry } = await this.runPi(params, buildAnnotationPrompt(sessionPromptParams(params, this.session.enabled)), {
			command: 'annotate',
			defaults: DEFAULT_ANNOTATION_OPTIONS,
			signal: context.signal,
			reportProgress: context.reportProgress,
		});
		return {
			kind: 'annotations',
			annotations: parseAnnotationResponse(content, annotationLineOffset(params), 'Pi', params.candidateLines),
			telemetry,
		};
	}

	async reviewCurrentHunk(
		params: ReviewCurrentHunkParams,
		context: AgentRuntimeRequestContext = {}
	): Promise<ReviewResult> {
		const { content: markdown } = await this.runPi(params, buildReviewPrompt(sessionPromptParams(params, this.session.enabled)), {
			command: 'review',
			defaults: {},
			signal: context.signal,
			reportProgress: context.reportProgress,
		});
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	async agentSessionReset(params: BaseRequestParams): Promise<ExplanationResult> {
		return {
			kind: 'explanation',
			markdown: this.sessions.reset(params, this.modelTarget()),
		};
	}

	async agentSessionStatus(params: BaseRequestParams): Promise<ExplanationResult> {
		return {
			kind: 'explanation',
			markdown: this.sessions.status(params, this.modelTarget()),
		};
	}

	private async runPi(params: BaseRequestParams, prompt: string, runOptions: RunPiOptions): Promise<RunPiResult> {
		await writeOptionalTrace(this.tracePromptPath, prompt);
		const startedAt = Date.now();
		const options = normalizeOptionsForProvider(
			this.provider,
			mergeOptions(this.options, runOptions.defaults, this.commandOptions[runOptions.command], {
				signal: runOptions.signal,
			})
		);
		const promptLines = prompt.split('\n').length;
		reportProgress(runOptions, 'prompt_ready', 'Prepared Pi prompt.', {
			command: runOptions.command,
			provider: this.provider,
			model: this.model,
			promptChars: prompt.length,
			promptLines,
			sessionEnabled: this.session.enabled,
			timeoutMs: options.timeoutMs,
			maxTokens: options.maxTokens,
			reasoning: options.reasoning,
		});
		const userMessage = userMessageFor(prompt);
		const invocation = this.session.enabled
			? this.sessions.createInvocation(params, this.modelTarget(), userMessage)
			: undefined;
		const context = invocation?.context ?? { messages: [userMessage] };
		const completionOptions = await this.resolveCredentials(params, {
			...options,
			...(invocation?.options ?? {}),
		}, runOptions.reportProgress);
		reportProgress(runOptions, 'model_request_started', 'Sent request to Pi model runtime.', {
			command: runOptions.command,
			provider: this.provider,
			model: this.model,
			timeoutMs: completionOptions.timeoutMs,
			maxTokens: completionOptions.maxTokens,
			reasoning: completionOptions.reasoning,
			sessionId: completionOptions.sessionId,
			cacheRetention: completionOptions.cacheRetention,
			hasApiKey: typeof completionOptions.apiKey === 'string' && completionOptions.apiKey.length > 0,
		});
		const assistantMessage = await this.completeWithTimeout(context, completionOptions);
		reportProgress(runOptions, 'model_response_received', 'Pi model runtime returned a response.', {
			command: runOptions.command,
			provider: this.provider,
			model: this.model,
			elapsedMs: Date.now() - startedAt,
			contentBlocks: assistantMessage.content.length,
			stopReason: assistantMessage.stopReason,
		});
		const content = extractAssistantText(assistantMessage);

		if (content.trim().length === 0) {
			throw new Error('Pi produced an empty response.');
		}

		if (invocation) {
			this.recordSuccessfulTurn(invocation.session, userMessage, assistantMessage);
		}

		await writeOptionalTrace(this.traceResponsePath, content);
		const returnedContent = runOptions.trimContent === false ? content : content.trim();
		return {
			content: returnedContent,
			telemetry: {
				runtime: 'pi',
				model: `${this.provider}/${this.model}`,
				promptChars: prompt.length,
				promptLines,
				elapsedMs: Date.now() - startedAt,
			},
		};
	}

	private async resolveCredentials(
		params: BaseRequestParams,
		options: PiCompleteOptions,
		reporter: ((progress: AgentRuntimeProgress) => void) | undefined
	): Promise<PiCompleteOptions> {
		reporter?.({
			stage: 'credentials_check',
			message: 'Checking configured API key and Pi OAuth credentials.',
			details: {
				provider: this.provider,
				authPath: this.auth?.path,
				hasConfiguredApiKey: typeof options.apiKey === 'string' && options.apiKey.trim().length > 0,
			},
		});

		if (typeof options.apiKey === 'string' && options.apiKey.trim().length > 0) {
			reporter?.({
				stage: 'credentials_configured',
				message: 'Using API key from Vantage configuration.',
				details: { provider: this.provider, source: 'agent.options.apiKey' },
			});
			return options;
		}

		const credentialRequest = {
			provider: this.provider,
			auth: this.auth,
			workspaceRoot: params.workspaceRoot,
		};
		const apiKey = await this.credentialResolver.resolveApiKey(
			reporter ? { ...credentialRequest, reportProgress: reporter } : credentialRequest
		);

		reporter?.({
			stage: apiKey ? 'credentials_resolved' : 'credentials_unresolved',
			message: apiKey
				? 'Resolved Pi OAuth credentials for the model provider.'
				: 'No Pi OAuth credentials were resolved; Pi/provider ambient auth may still be used.',
			details: {
				provider: this.provider,
				source: apiKey ? 'pi_oauth' : 'ambient',
			},
		});

		return apiKey ? { ...options, apiKey } : options;
	}

	private modelTarget(): { provider: string; model: string } {
		return {
			provider: this.provider,
			model: this.model,
		};
	}

	private recordSuccessfulTurn(
		session: SessionState,
		userMessage: AgentSessionMessage,
		assistantMessage: PiAssistantMessage
	): void {
		this.sessions.recordSuccessfulTurn(
			session,
			userMessage,
			assistantMessageForHistory(assistantMessage, this.provider, this.model)
		);
	}

	private async completeWithTimeout(context: PiContext, options: PiCompleteOptions): Promise<PiAssistantMessage> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
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
				reject(new Error(`Pi request timed out after ${timeoutMs}ms.`));
				controller.abort();
			}, timeoutMs);
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

function reportProgress(
	runOptions: Pick<RunPiOptions, 'reportProgress'>,
	stage: string,
	message: string,
	details?: Record<string, unknown>
): void {
	runOptions.reportProgress?.({ stage, message, details });
}

export class PiSdkRuntime implements PiRuntime {
	async complete(provider: string, model: string, context: PiContext, options: PiCompleteOptions): Promise<PiAssistantMessage> {
		const pi = await importPiAi();
		const resolvedModel = pi.getModel(provider as KnownProvider, model as never) as Model<Api> | undefined;
		if (!resolvedModel) {
			throw new Error(`Unknown Pi model "${provider}/${model}".`);
		}

		return pi.completeSimple(resolvedModel, context, options as SimpleStreamOptions);
	}
}

async function importPiAi(): Promise<typeof import('@earendil-works/pi-ai')> {
	const dynamicImport = new Function('specifier', 'return import(specifier)') as (
		specifier: string
	) => Promise<typeof import('@earendil-works/pi-ai')>;
	return dynamicImport('@earendil-works/pi-ai');
}

function mergeOptions(
	base: AgentOptionsConfig,
	defaults: AgentOptionsConfig,
	command: AgentOptionsConfig | undefined,
	override: Pick<PiCompleteOptions, 'signal'>
): PiCompleteOptions {
	return {
		...base,
		...defaults,
		...(command ?? {}),
		...override,
	};
}

function normalizeOptionsForProvider(provider: string, options: PiCompleteOptions): PiCompleteOptions {
	if (provider !== 'openai-codex') {
		return options;
	}

	const sanitized = { ...options };
	delete sanitized.temperature;
	return sanitized;
}

function assistantMessageForHistory(
	message: PiAssistantMessage,
	provider: string,
	model: string
): PiContext['messages'][number] {
	return {
		role: 'assistant',
		content: message.content as never,
		api: message.api ?? 'openai-responses',
		provider: message.provider ?? provider,
		model: message.model ?? model,
		responseModel: message.responseModel,
		responseId: message.responseId,
		diagnostics: message.diagnostics as never,
		usage: message.usage ?? usage,
		stopReason: message.stopReason ?? 'stop',
		errorMessage: message.errorMessage,
		timestamp: message.timestamp ?? Date.now(),
	};
}

function extractAssistantText(message: PiAssistantMessage): string {
	if (message.stopReason === 'error' && message.errorMessage) {
		throw new Error(`Pi agent runtime failed: ${message.errorMessage}`);
	}

	const parts = message.content
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text ?? '')
		.filter((text) => text.trim().length > 0);

	if (parts.length === 0) {
		throw new Error('Pi agent runtime returned an unexpected response shape.');
	}

	return parts.join('\n');
}

async function writeOptionalTrace(filePath: string | undefined, content: string): Promise<void> {
	if (!filePath || filePath.trim() === '') {
		return;
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, 'utf8');
}
