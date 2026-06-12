import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Clock, Effect, Schedule } from 'effect';
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
	AgentRuntimeProgress,
} from './protocol';
import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import {
	annotationLineOffset,
	buildAnnotationPrompt,
	buildEditPrompt,
	buildExplainPrompt,
	buildQuestionPrompt,
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
import {
	CredentialResolutionError,
	EmptyModelResponseError,
	errorMessage,
	ModelCompletionError,
	ModelRequestCancelledError,
	ModelRequestTimedOutError,
	TraceWriteError,
	UnexpectedModelResponseError,
} from './effect-errors';

export interface CommandAgentOptions {
	explain?: AgentOptionsConfig;
	question?: AgentOptionsConfig;
	edit?: AgentOptionsConfig;
	annotate?: AgentOptionsConfig;
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

	async searchLocations(): Promise<import('./protocol').SearchLocationsResult> {
		throw new Error('searchLocations requires the Pi coding-agent runtime.');
	}

	async agentCancel(): Promise<ExplanationResult> {
		return {
			kind: 'explanation',
			markdown: '## Vantage Agent\n\nNo active agent request.',
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
		return Effect.runPromise(Effect.raceFirst(
			this.runPiEffect(params, prompt, runOptions),
			abortSignalEffect(runOptions.signal)
		));
	}

	private runPiEffect(
		params: BaseRequestParams,
		prompt: string,
		runOptions: RunPiOptions
	): Effect.Effect<
		RunPiResult,
		| TraceWriteError
		| CredentialResolutionError
		| ModelCompletionError
		| ModelRequestTimedOutError
		| ModelRequestCancelledError
		| EmptyModelResponseError
		| UnexpectedModelResponseError
	> {
		const {
			provider,
			model,
			options: agentOptions,
			commandOptions,
			session,
			sessions,
			tracePromptPath,
			traceResponsePath,
		} = this;
		const modelTarget = this.modelTarget();
		const resolveCredentials = (completionParams: BaseRequestParams, completionOptions: PiCompleteOptions) =>
			this.resolveCredentialsEffect(completionParams, completionOptions, runOptions.reportProgress);
		const completeWithTimeout = (context: PiContext, completionOptions: PiCompleteOptions) =>
			this.completeWithTimeoutEffect(context, completionOptions);
		const recordSuccessfulTurn = (
			sessionState: SessionState,
			userMessage: AgentSessionMessage,
			assistantMessage: PiAssistantMessage
		) => {
			this.recordSuccessfulTurn(sessionState, userMessage, assistantMessage);
		};

		return Effect.gen(function* () {
			yield* writeOptionalTraceEffect(tracePromptPath, prompt);
			const startedAt = yield* Clock.currentTimeMillis;
			const options = normalizeOptionsForProvider(
				provider,
				mergeOptions(agentOptions, runOptions.defaults, commandOptions[runOptions.command], {
					signal: runOptions.signal,
				})
			);
			const promptLines = prompt.split('\n').length;
			reportProgress(runOptions, 'prompt_ready', 'Prepared Pi prompt.', {
				command: runOptions.command,
				provider,
				model,
				promptChars: prompt.length,
				promptLines,
				sessionEnabled: session.enabled,
				timeoutMs: options.timeoutMs,
				maxTokens: options.maxTokens,
				reasoning: options.reasoning,
			});
			const userMessage = userMessageFor(prompt);
			const invocation = session.enabled
				? sessions.createInvocation(params, modelTarget, userMessage)
				: undefined;
			const context = invocation?.context ?? { messages: [userMessage] };
			const completionOptions = yield* resolveCredentials(params, {
				...options,
				...(invocation?.options ?? {}),
			});
			reportProgress(runOptions, 'model_request_started', 'Sent request to Pi model runtime.', {
				command: runOptions.command,
				provider,
				model,
				timeoutMs: completionOptions.timeoutMs,
				maxTokens: completionOptions.maxTokens,
				reasoning: completionOptions.reasoning,
				sessionId: completionOptions.sessionId,
				cacheRetention: completionOptions.cacheRetention,
				hasApiKey: typeof completionOptions.apiKey === 'string' && completionOptions.apiKey.length > 0,
			});
			const assistantMessage = yield* completeWithTimeout(context, completionOptions);
			const responseReceivedAt = yield* Clock.currentTimeMillis;
			reportProgress(runOptions, 'model_response_received', 'Pi model runtime returned a response.', {
				command: runOptions.command,
				provider,
				model,
				elapsedMs: responseReceivedAt - startedAt,
				contentBlocks: assistantMessage.content.length,
				stopReason: assistantMessage.stopReason,
			});
			const content = yield* extractAssistantTextEffect(assistantMessage);

			if (content.trim().length === 0) {
				return yield* new EmptyModelResponseError({
					message: 'Pi produced an empty response.',
				});
			}

			if (invocation) {
				recordSuccessfulTurn(invocation.session, userMessage, assistantMessage);
			}

			yield* writeOptionalTraceEffect(traceResponsePath, content);
			const completedAt = yield* Clock.currentTimeMillis;
			const returnedContent = runOptions.trimContent === false ? content : content.trim();
			const telemetry: RunPiResult['telemetry'] = {
				runtime: 'pi',
				model: `${provider}/${model}`,
				promptChars: prompt.length,
				promptLines,
				elapsedMs: completedAt - startedAt,
			};
			return {
				content: returnedContent,
				telemetry,
			};
		});
	}

	private resolveCredentialsEffect(
		params: BaseRequestParams,
		options: PiCompleteOptions,
		reporter: ((progress: AgentRuntimeProgress) => void) | undefined
	): Effect.Effect<PiCompleteOptions, CredentialResolutionError> {
		const { provider, auth, credentialResolver } = this;
		return Effect.gen(function* () {
			reporter?.({
				stage: 'credentials_check',
				message: 'Checking configured API key and Pi OAuth credentials.',
				details: {
					provider,
					authPath: auth?.path,
					hasConfiguredApiKey: typeof options.apiKey === 'string' && options.apiKey.trim().length > 0,
				},
			});

			if (typeof options.apiKey === 'string' && options.apiKey.trim().length > 0) {
				reporter?.({
					stage: 'credentials_configured',
					message: 'Using API key from Vantage configuration.',
					details: { provider, source: 'agent.options.apiKey' },
				});
				return options;
			}

			const credentialRequest = {
				provider,
				auth,
				workspaceRoot: params.workspaceRoot,
			};
			const apiKey: string | undefined = yield* Effect.tryPromise({
				try: () => credentialResolver.resolveApiKey(
					reporter ? { ...credentialRequest, reportProgress: reporter } : credentialRequest
				),
				catch: (cause) => new CredentialResolutionError({
					message: errorMessage(cause),
					cause,
				}),
			});

			reporter?.({
				stage: apiKey ? 'credentials_resolved' : 'credentials_unresolved',
				message: apiKey
					? 'Resolved Pi OAuth credentials for the model provider.'
					: 'No Pi OAuth credentials were resolved; Pi/provider ambient auth may still be used.',
				details: {
					provider,
					source: apiKey ? 'pi_oauth' : 'ambient',
				},
			});

			return apiKey ? { ...options, apiKey } : options;
		});
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

	private completeWithTimeoutEffect(
		context: PiContext,
		options: PiCompleteOptions
	): Effect.Effect<PiAssistantMessage, ModelCompletionError | ModelRequestTimedOutError | ModelRequestCancelledError> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
		const completion = Effect.tryPromise({
			try: (signal) => this.runtime.complete(this.provider, this.model, context, { ...options, signal }),
			catch: (cause) => new ModelCompletionError({
				message: errorMessage(cause),
				cause,
			}),
		}).pipe(
			Effect.timeoutFail({
				duration: `${timeoutMs} millis`,
				onTimeout: () => new ModelRequestTimedOutError({
					message: `Pi request timed out after ${timeoutMs}ms.`,
					timeoutMs,
				}),
			})
		);

		return Effect.raceFirst(retryModelRequest(completion, options), abortSignalEffect(options.signal));
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

function retryModelRequest(
	effect: Effect.Effect<PiAssistantMessage, ModelCompletionError | ModelRequestTimedOutError>,
	options: PiCompleteOptions
): Effect.Effect<PiAssistantMessage, ModelCompletionError | ModelRequestTimedOutError> {
	const times = options.maxRetries ?? 0;
	if (times <= 0) {
		return effect;
	}

	const delayMs = options.maxRetryDelayMs ?? 0;
	if (delayMs <= 0) {
		return Effect.retry(effect, { times });
	}

	return Effect.retry(
		effect,
		Schedule.intersect(
			Schedule.recurs(times),
			Schedule.spaced(`${delayMs} millis`)
		)
	);
}

function abortSignalEffect(signal: AbortSignal | undefined): Effect.Effect<never, ModelRequestCancelledError> {
	if (!signal) {
		return Effect.never;
	}

	return Effect.async<never, ModelRequestCancelledError>((resume, fiberSignal) => {
		const abort = (): void => {
			resume(Effect.fail(new ModelRequestCancelledError({
				message: 'Pi request cancelled.',
			})));
		};

		if (signal.aborted) {
			abort();
			return;
		}

		signal.addEventListener('abort', abort, { once: true });
		fiberSignal.addEventListener('abort', () => {
			signal.removeEventListener('abort', abort);
		}, { once: true });
	});
}

function extractAssistantTextEffect(
	message: PiAssistantMessage
): Effect.Effect<string, ModelCompletionError | UnexpectedModelResponseError> {
	return Effect.gen(function* () {
		if (message.stopReason === 'error' && message.errorMessage) {
			return yield* new ModelCompletionError({
				message: `Pi agent runtime failed: ${message.errorMessage}`,
			});
		}

		const parts = message.content
			.filter((block) => block.type === 'text' && typeof block.text === 'string')
			.map((block) => block.text ?? '')
			.filter((text) => text.trim().length > 0);

		if (parts.length === 0) {
			return yield* new UnexpectedModelResponseError({
				message: 'Pi agent runtime returned an unexpected response shape.',
			});
		}

		return parts.join('\n');
	});
}

function writeOptionalTraceEffect(filePath: string | undefined, content: string): Effect.Effect<void, TraceWriteError> {
	if (!filePath || filePath.trim() === '') {
		return Effect.void;
	}

	return Effect.tryPromise({
		try: async () => {
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, content, 'utf8');
		},
		catch: (cause) => new TraceWriteError({
			path: filePath,
			message: `Failed to write Pi trace at ${filePath}: ${errorMessage(cause)}`,
			cause,
		}),
	});
}
