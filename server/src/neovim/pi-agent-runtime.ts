import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { Api, Context, KnownProvider, Model, SimpleStreamOptions, StopReason } from '@earendil-works/pi-ai';
import type {
	AgentCacheRetention,
	AgentContext,
	AgentOptionsConfig,
	AgentSessionConfig,
	AnnotateRangeParams,
	AnnotationResult,
	BaseRequestParams,
	ExplainSelectionParams,
	ExplanationResult,
	LensMode,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';
import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import {
	annotationLineOffset,
	buildAgentContextUpdatePrompt,
	buildAnnotationPrompt,
	buildExplainPrompt,
	buildReviewPrompt,
	parseAnnotationResponse,
} from './model-contract';

export interface CommandAgentOptions {
	explain?: AgentOptionsConfig;
	annotate?: AgentOptionsConfig;
	review?: AgentOptionsConfig;
}

export interface PiAgentRuntimeOptions {
	provider?: string;
	model?: string;
	options?: AgentOptionsConfig;
	session?: AgentSessionConfig;
	commandOptions?: CommandAgentOptions;
	tracePromptPath?: string;
	traceResponsePath?: string;
	runtime?: PiRuntime;
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
	timeoutMs: 30_000,
};
const DEFAULT_SESSION_CONFIG: Required<AgentSessionConfig> = {
	enabled: true,
	max_turns: 12,
	cacheRetention: 'short',
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

interface SessionScope {
	workspaceRoot: string;
	provider: string;
	model: string;
	lensMode: LensMode;
}

interface SessionTurn {
	user: PiContext['messages'][number];
	assistant: PiContext['messages'][number];
}

interface SessionState {
	scope: SessionScope;
	sessionId: string;
	createdAt: number;
	updatedAt: number;
	latestContextRevision?: string;
	latestContextTurn?: PiContext['messages'][number];
	turns: SessionTurn[];
}

export class AgentSessionStore {
	private readonly sessions = new Map<string, SessionState>();

	get(scope: SessionScope): SessionState {
		const key = scopeKey(scope);
		const existing = this.sessions.get(key);
		if (existing) {
			return existing;
		}

		const now = Date.now();
		const session: SessionState = {
			scope,
			sessionId: `vantage-${hashText(key).slice(0, 24)}`,
			createdAt: now,
			updatedAt: now,
			turns: [],
		};
		this.sessions.set(key, session);
		return session;
	}

	status(scope: SessionScope): SessionState | undefined {
		return this.sessions.get(scopeKey(scope));
	}

	reset(scope: SessionScope): boolean {
		return this.sessions.delete(scopeKey(scope));
	}
}

export class PiAgentRuntime implements AgentRuntime {
	readonly provider: string;
	readonly model: string;
	readonly options: AgentOptionsConfig;
	readonly session: Required<AgentSessionConfig>;
	readonly commandOptions: CommandAgentOptions;
	readonly tracePromptPath?: string;
	readonly traceResponsePath?: string;
	private readonly runtime: PiRuntime;
	private readonly sessionStore: AgentSessionStore;

	constructor(options: PiAgentRuntimeOptions = {}) {
		this.provider = options.provider ?? DEFAULT_PROVIDER;
		this.model = options.model ?? DEFAULT_MODEL;
		this.options = { ...DEFAULT_OPTIONS, ...(options.options ?? {}) };
		this.session = { ...DEFAULT_SESSION_CONFIG, ...(options.session ?? {}) };
		this.commandOptions = options.commandOptions ?? {};
		this.tracePromptPath = options.tracePromptPath;
		this.traceResponsePath = options.traceResponsePath;
		this.runtime = options.runtime ?? new PiSdkRuntime();
		this.sessionStore = options.sessionStore ?? new AgentSessionStore();
	}

	async explainSelection(params: ExplainSelectionParams, context: AgentRuntimeRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runPi(params, buildExplainPrompt(sessionPromptParams(params, this.session.enabled)), {
			command: 'explain',
			defaults: {},
			signal: context.signal,
		});
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async annotateRange(params: AnnotateRangeParams, context: AgentRuntimeRequestContext = {}): Promise<AnnotationResult> {
		const { content, telemetry } = await this.runPi(params, buildAnnotationPrompt(sessionPromptParams(params, this.session.enabled)), {
			command: 'annotate',
			defaults: DEFAULT_ANNOTATION_OPTIONS,
			signal: context.signal,
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
		});
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	async agentSessionReset(params: BaseRequestParams): Promise<ExplanationResult> {
		if (!this.session.enabled) {
			return { kind: 'explanation', markdown: '## Vantage Agent Session\n\nAgent sessions are disabled.' };
		}

		const scope = this.sessionScope(params);
		const removed = this.sessionStore.reset(scope);
		return {
			kind: 'explanation',
			markdown: [
				'## Vantage Agent Session',
				'',
				removed ? 'Session reset.' : 'No active session existed for this scope.',
				'',
				`Workspace: \`${scope.workspaceRoot}\``,
				`Model target: \`${scope.provider}/${scope.model}\``,
				`Lens mode: \`${scope.lensMode}\``,
			].join('\n'),
		};
	}

	async agentSessionStatus(params: BaseRequestParams): Promise<ExplanationResult> {
		if (!this.session.enabled) {
			return { kind: 'explanation', markdown: '## Vantage Agent Session\n\nAgent sessions are disabled.' };
		}

		const scope = this.sessionScope(params);
		const session = this.sessionStore.status(scope);
		return {
			kind: 'explanation',
			markdown: renderSessionStatus(scope, session),
		};
	}

	private async runPi(params: BaseRequestParams, prompt: string, runOptions: RunPiOptions): Promise<RunPiResult> {
		await writeOptionalTrace(this.tracePromptPath, prompt);
		const startedAt = Date.now();
		const options = mergeOptions(this.options, runOptions.defaults, this.commandOptions[runOptions.command], {
			signal: runOptions.signal,
		});
		const userMessage = userMessageFor(prompt);
		const session = this.session.enabled ? this.sessionStore.get(this.sessionScope(params)) : undefined;
		const context = session
			? this.sessionContext(session, params.agentContext, userMessage)
			: { messages: [userMessage] };
		const sessionOptions = session
			? {
				sessionId: session.sessionId,
				cacheRetention: this.session.cacheRetention,
			}
			: {};
		const assistantMessage = await this.completeWithTimeout(context, {
			...options,
			...sessionOptions,
		});
		const content = extractAssistantText(assistantMessage);

		if (content.trim().length === 0) {
			throw new Error('Pi produced an empty response.');
		}

		if (session) {
			this.recordSuccessfulTurn(session, userMessage, assistantMessage);
		}

		await writeOptionalTrace(this.traceResponsePath, content);
		return {
			content: content.trim(),
			telemetry: {
				runtime: 'pi',
				model: `${this.provider}/${this.model}`,
				promptChars: prompt.length,
				promptLines: prompt.split('\n').length,
				elapsedMs: Date.now() - startedAt,
			},
		};
	}

	private sessionScope(params: BaseRequestParams): SessionScope {
		return {
			workspaceRoot: params.workspaceRoot ?? workspaceFromFilePath(params.filePath),
			provider: this.provider,
			model: this.model,
			lensMode: params.lens?.mode ?? 'general',
		};
	}

	private sessionContext(
		session: SessionState,
		agentContext: AgentContext | undefined,
		userMessage: PiContext['messages'][number]
	): PiContext {
		const contextRevision = agentContext ? agentContextRevision(agentContext) : undefined;
		if (agentContext && contextRevision !== session.latestContextRevision) {
			session.latestContextRevision = contextRevision;
			session.latestContextTurn = userMessageFor(buildAgentContextUpdatePrompt({
				...agentContext,
				revision: contextRevision,
			}));
			session.updatedAt = Date.now();
		}

		const messages: PiContext['messages'] = [];
		if (session.latestContextTurn) {
			messages.push(session.latestContextTurn);
		}
		for (const turn of session.turns) {
			messages.push(turn.user, turn.assistant);
		}
		messages.push(userMessage);
		return { messages };
	}

	private recordSuccessfulTurn(
		session: SessionState,
		userMessage: PiContext['messages'][number],
		assistantMessage: PiAssistantMessage
	): void {
		session.turns.push({
			user: userMessage,
			assistant: assistantMessageForHistory(assistantMessage, this.provider, this.model),
		});
		while (session.turns.length > this.session.max_turns) {
			session.turns.shift();
		}
		session.updatedAt = Date.now();
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

function scopeKey(scope: SessionScope): string {
	return JSON.stringify(scope);
}

function hashText(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

function agentContextRevision(agentContext: AgentContext): string {
	return agentContext.revision ?? hashText([
		agentContext.path,
		agentContext.modifiedAt ?? '',
		agentContext.truncated ? 'truncated' : 'full',
		agentContext.content,
	].join('\0'));
}

function workspaceFromFilePath(filePath: string): string {
	if (filePath.trim().length === 0) {
		return 'unknown-workspace';
	}
	return path.dirname(filePath);
}

function userMessageFor(content: string): PiContext['messages'][number] {
	return {
		role: 'user',
		content,
		timestamp: Date.now(),
	};
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

function sessionPromptParams<T extends BaseRequestParams>(params: T, sessionEnabled: boolean): T {
	if (!sessionEnabled || !params.agentContext) {
		return params;
	}

	return {
		...params,
		agentContext: undefined,
	};
}

function renderSessionStatus(scope: SessionScope, session: SessionState | undefined): string {
	const lines = [
		'## Vantage Agent Session',
		'',
		`Workspace: \`${scope.workspaceRoot}\``,
		`Model target: \`${scope.provider}/${scope.model}\``,
		`Lens mode: \`${scope.lensMode}\``,
		`Turn count: ${session?.turns.length ?? 0}`,
	];

	if (session) {
		lines.push(`Session id: \`${session.sessionId}\``);
		lines.push(`Latest context revision: \`${session.latestContextRevision ?? 'none'}\``);
		lines.push(`Created: ${new Date(session.createdAt).toISOString()}`);
		lines.push(`Updated: ${new Date(session.updatedAt).toISOString()}`);
	} else {
		lines.push('No active session exists for this scope.');
	}

	return lines.join('\n');
}

function extractAssistantText(message: PiAssistantMessage): string {
	if (message.stopReason === 'error' && message.errorMessage) {
		throw new Error(`Pi agent runtime failed: ${message.errorMessage}`);
	}

	const parts = message.content
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text?.trim() ?? '')
		.filter((text) => text.length > 0);

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
