import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Model } from '@earendil-works/pi-ai';
import type { AgentSession, AuthStorage, ModelRegistry, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import type {
	AgentAuthConfig,
	AgentOptionsConfig,
	Annotation,
	AnnotationResult,
	BaseRequestParams,
	EditResult,
	EditSelectionParams,
	ExplainSelectionParams,
	ExplanationResult,
	QuestionSelectionParams,
	SearchLocation,
	SearchLocationsParams,
	SearchLocationsResult,
} from './protocol';
import {
	buildAnnotationPrompt,
	buildEditPrompt,
	buildExplainPrompt,
	buildQuestionPrompt,
	buildSearchPrompt,
	parseAnnotationPayload,
	parseEditPayload,
} from './model-contract';
import { PiOAuthCredentialResolver, type PiCredentialResolver } from './pi-oauth-auth';
import { errorMessage } from './effect-errors';

interface CommandConfig {
	include_lens?: boolean;
	options?: AgentOptionsConfig;
	default_prompt?: string;
}

export interface CodingAgentRuntimeOptions {
	provider?: string;
	model?: string;
	auth?: AgentAuthConfig;
	options?: AgentOptionsConfig;
	commandOptions?: {
		explain?: CommandConfig;
		question?: CommandConfig;
		edit?: CommandConfig;
		annotate?: CommandConfig;
		search?: CommandConfig;
	};
	store?: CodingAgentSessionStore;
	credentialResolver?: PiCredentialResolver;
}

interface CodingAgentModule {
	AuthStorage: typeof AuthStorage;
	ModelRegistry: typeof ModelRegistry;
	SessionManager: typeof SessionManager;
	createAgentSession(options?: {
		cwd?: string;
		authStorage?: AuthStorage;
		modelRegistry?: ModelRegistry;
		model?: Model<never>;
		thinkingLevel?: string;
		tools?: string[];
		customTools?: ToolDefinition[];
		sessionManager?: SessionManager;
	}): Promise<{ session: AgentSession }>;
	defineTool<T extends ToolDefinition>(tool: T): T;
}

interface PiAiModule {
	Type: typeof import('@earendil-works/pi-ai').Type;
}

interface SessionRecord {
	workspaceRoot: string;
	provider: string;
	model: string;
	session: AgentSession;
}

interface ActiveRequest {
	kind: string;
	abort: () => Promise<void> | void;
}

interface SubmissionContext {
	params: BaseRequestParams;
	handlers: SubmissionHandlers;
}

interface SubmissionHandlers {
	onSearch?: (locations: SearchLocation[]) => void;
	onEdit?: (replacementText: string) => void;
	onAnnotations?: (annotations: Annotation[]) => void;
}

export class CodingAgentSessionStore {
	private record?: SessionRecord;
	private active?: ActiveRequest;

	isActive(): boolean {
		return this.active !== undefined;
	}

	activeKind(): string | undefined {
		return this.active?.kind;
	}

	begin(kind: string, abort: () => Promise<void> | void): void {
		if (this.active) {
			throw new Error(`Vantage agent is already running ${this.active.kind}. Use :VantageAgentCancel first.`);
		}
		this.active = { kind, abort };
	}

	end(): void {
		this.active = undefined;
	}

	async cancel(): Promise<boolean> {
		const active = this.active;
		if (!active) {
			return false;
		}
		await active.abort();
		this.active = undefined;
		return true;
	}

	async reset(): Promise<boolean> {
		if (this.active) {
			throw new Error('Vantage agent is busy. Use :VantageAgentCancel before reset.');
		}
		if (!this.record) {
			return false;
		}
		this.record.session.dispose();
		this.record = undefined;
		return true;
	}

	status(): { active?: string; session?: SessionRecord } {
		return {
			active: this.active?.kind,
			session: this.record,
		};
	}

	async getOrCreate(options: {
		workspaceRoot: string;
		provider: string;
		model: string;
		thinkingLevel?: string;
		auth?: AgentAuthConfig;
		apiKey?: string;
		credentialResolver: PiCredentialResolver;
		customTools: ToolDefinition[];
	}): Promise<AgentSession> {
		if (this.record && this.record.workspaceRoot === options.workspaceRoot) {
			return this.record.session;
		}

		if (this.record) {
			this.record.session.dispose();
			this.record = undefined;
		}

		const piAgent = await importCodingAgent();
		const authStorage = piAgent.AuthStorage.create();
		const resolvedApiKey = options.apiKey && options.apiKey.trim().length > 0
			? options.apiKey
			: await options.credentialResolver.resolveApiKey({
				provider: options.provider,
				auth: options.auth,
				workspaceRoot: options.workspaceRoot,
			});
		if (resolvedApiKey) {
			authStorage.setRuntimeApiKey(options.provider, resolvedApiKey);
		}
		const modelRegistry = piAgent.ModelRegistry.create(authStorage);
		const model = modelRegistry.find(options.provider, options.model);
		if (!model) {
			throw new Error(`Unknown Pi model "${options.provider}/${options.model}".`);
		}

		const { session } = await piAgent.createAgentSession({
			cwd: options.workspaceRoot,
			authStorage,
			modelRegistry,
			model: model as Model<never>,
			thinkingLevel: options.thinkingLevel,
			tools: ['read', 'grep', 'find', 'ls', 'submit_search_results', 'submit_edit', 'submit_annotations'],
			customTools: options.customTools,
			sessionManager: piAgent.SessionManager.inMemory(options.workspaceRoot),
		});
		this.record = {
			workspaceRoot: options.workspaceRoot,
			provider: options.provider,
			model: options.model,
			session,
		};
		return session;
	}
}

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_OPTIONS: Required<Pick<AgentOptionsConfig, 'maxTokens' | 'temperature' | 'timeoutMs'>> = {
	maxTokens: 1024,
	temperature: 0.1,
	timeoutMs: 300_000,
};
const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls'];

export class CodingAgentRuntime implements AgentRuntime {
	readonly provider: string;
	readonly model: string;
	readonly auth?: AgentAuthConfig;
	readonly options: AgentOptionsConfig;
	readonly commandOptions: NonNullable<CodingAgentRuntimeOptions['commandOptions']>;
	private readonly store: CodingAgentSessionStore;
	private readonly credentialResolver: PiCredentialResolver;
	private currentSubmission?: SubmissionContext;

	constructor(options: CodingAgentRuntimeOptions = {}) {
		this.provider = options.provider ?? DEFAULT_PROVIDER;
		this.model = options.model ?? DEFAULT_MODEL;
		this.auth = options.auth;
		this.options = { ...DEFAULT_OPTIONS, ...(options.options ?? {}) };
		this.commandOptions = options.commandOptions ?? {};
		this.store = options.store ?? new CodingAgentSessionStore();
		this.credentialResolver = options.credentialResolver ?? new PiOAuthCredentialResolver();
	}

	async explainSelection(params: ExplainSelectionParams, context: AgentRuntimeRequestContext = {}): Promise<ExplanationResult> {
		const prompt = buildExplainPrompt(this.paramsForLens(params, this.includeLens('explain', true)));
		return { kind: 'explanation', markdown: await this.runMarkdown('explain', params, prompt, context, READ_ONLY_TOOLS) };
	}

	async questionSelection(params: QuestionSelectionParams, context: AgentRuntimeRequestContext = {}): Promise<ExplanationResult> {
		const prompt = buildQuestionPrompt(this.paramsForLens(params, this.includeLens('question', false)));
		return { kind: 'explanation', markdown: await this.runMarkdown('question', params, prompt, context, READ_ONLY_TOOLS) };
	}

	async editSelection(params: EditSelectionParams, context: AgentRuntimeRequestContext = {}): Promise<EditResult> {
		let submitted: string | undefined;
		let assistantFallback = '';
		const submission: SubmissionContext = {
			params,
			handlers: {
				onEdit: (replacementText) => {
					submitted = replacementText;
				},
			},
		};
		const prompt = buildEditPrompt(this.paramsForLens(params, this.includeLens('edit', false)));
		await this.runPrompt('edit', params, prompt, context, [...READ_ONLY_TOOLS, 'submit_edit'], false, submission, (text) => {
			assistantFallback = text;
		});
		if (submitted === undefined && assistantFallback.trim().length > 0) {
			submitted = parseEditPayload(assistantFallback);
		}
		if (submitted === undefined) {
			throw new Error('Vantage edit did not receive submit_edit from the agent.');
		}
		return {
			kind: 'edit',
			replacementText: submitted,
		};
	}

	async annotateRange(params: import('./protocol').AnnotateRangeParams, context: AgentRuntimeRequestContext = {}): Promise<AnnotationResult> {
		let submitted: Annotation[] | undefined;
		const submission: SubmissionContext = {
			params,
			handlers: {
				onAnnotations: (annotations) => {
					submitted = annotations;
				},
			},
		};
		const prompt = buildAnnotationPrompt(params);
		await this.runPrompt('annotate', params, prompt, context, ['submit_annotations'], true, submission);
		if (!submitted) {
			throw new Error('Vantage annotate did not receive submit_annotations from the agent.');
		}
		return {
			kind: 'annotations',
			annotations: submitted,
		};
	}

	async searchLocations(params: SearchLocationsParams, context: AgentRuntimeRequestContext = {}): Promise<SearchLocationsResult> {
		let submitted: SearchLocation[] | undefined;
		let assistantFallback = '';
		const submission: SubmissionContext = {
			params,
			handlers: {
				onSearch: (locations) => {
					submitted = locations;
				},
			},
		};
		const prompt = buildSearchPrompt(this.paramsForLens(params, this.includeLens('search', true)));
		await this.runPrompt('search', params, prompt, context, [...READ_ONLY_TOOLS, 'submit_search_results'], false, submission, (text) => {
			assistantFallback = text;
		});
		if (!submitted && assistantFallback.trim().length > 0) {
			submitted = parseSearchFallback(workspaceRoot(params), assistantFallback);
		}
		if (!submitted) {
			throw new Error('Vantage search did not receive submit_search_results from the agent.');
		}
		return {
			kind: 'locations',
			locations: submitted,
		};
	}

	async agentCancel(): Promise<ExplanationResult> {
		const cancelled = await this.store.cancel();
		return {
			kind: 'explanation',
			markdown: cancelled ? '## Vantage Agent\n\nCancelled active agent request.' : '## Vantage Agent\n\nNo active agent request.',
		};
	}

	async agentSessionReset(): Promise<ExplanationResult> {
		const removed = await this.store.reset();
		return {
			kind: 'explanation',
			markdown: removed ? '## Vantage Agent Session\n\nSession reset.' : '## Vantage Agent Session\n\nNo active session existed.',
		};
	}

	async agentSessionStatus(): Promise<ExplanationResult> {
		const status = this.store.status();
		return {
			kind: 'explanation',
			markdown: [
				'## Vantage Agent Session',
				'',
				`Active request: ${status.active ? `\`${status.active}\`` : '`none`'}`,
				`Session: ${status.session ? '`active`' : '`none`'}`,
				status.session ? `Workspace: \`${status.session.workspaceRoot}\`` : undefined,
				status.session ? `Model target: \`${status.session.provider}/${status.session.model}\`` : undefined,
			].filter((line): line is string => line !== undefined).join('\n'),
		};
	}

	private includeLens(command: keyof NonNullable<CodingAgentRuntimeOptions['commandOptions']>, defaultValue: boolean): boolean {
		return this.commandOptions[command]?.include_lens ?? defaultValue;
	}

	private commandOptionsFor(command: string): AgentOptionsConfig {
		const scoped = this.commandOptions[command as keyof NonNullable<CodingAgentRuntimeOptions['commandOptions']>]?.options;
		return { ...this.options, ...(scoped ?? {}) };
	}

	private paramsForLens<T extends BaseRequestParams>(params: T, includeLens: boolean): T {
		return includeLens ? params : { ...params, lens: undefined };
	}

	private async runMarkdown(
		kind: string,
		params: BaseRequestParams,
		prompt: string,
		context: AgentRuntimeRequestContext,
		tools: string[]
	): Promise<string> {
		let text = '';
		await this.runPrompt(kind, params, prompt, context, tools, false, undefined, (value) => {
			text = value;
		});
		if (text.trim().length === 0) {
			throw new Error(`Vantage ${kind} produced an empty response.`);
		}
		return text.trim();
	}

	private async runPrompt(
		kind: string,
		params: BaseRequestParams,
		prompt: string,
		context: AgentRuntimeRequestContext,
		activeTools: string[],
		transient: boolean,
		submission?: SubmissionContext,
		onAssistantText?: (text: string) => void
	): Promise<void> {
		context.reportProgress?.({ stage: 'agent_session_start', message: `Starting Vantage ${kind} agent request.` });
		const customTools = await this.submissionTools();
		const session = transient
			? await this.createTransientSession(params, customTools)
			: await this.store.getOrCreate({
				workspaceRoot: workspaceRoot(params),
				provider: this.provider,
				model: this.model,
				thinkingLevel: this.options.reasoning,
				auth: this.auth,
				apiKey: this.options.apiKey,
				credentialResolver: this.credentialResolver,
				customTools,
			});
		session.setActiveToolsByName(activeTools);

		const abort = async () => {
			await session.abort();
		};
		if (!transient) {
			this.store.begin(kind, abort);
		}
		const abortListener = () => {
			void abort();
		};
		context.signal?.addEventListener('abort', abortListener, { once: true });
		const options = this.commandOptionsFor(kind);
		const timeout = setTimeout(() => {
			void abort();
		}, options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs);
		const previousSubmission = this.currentSubmission;
		this.currentSubmission = submission;
		const unsubscribe = session.subscribe((event) => {
			if (event.type === 'message_update') {
				context.reportProgress?.({ stage: 'agent_message_update', message: `Vantage ${kind} agent is responding.` });
			}
			if (event.type === 'tool_execution_start') {
				context.reportProgress?.({
					stage: 'agent_tool_started',
					message: `Vantage ${kind} agent called ${event.toolName}.`,
					details: { toolName: event.toolName },
				});
			}
			if (event.type === 'message_end' && event.message.role === 'assistant') {
				onAssistantText?.(assistantText(event.message));
			}
		});
		try {
			await session.prompt(prompt, { source: 'rpc' });
			context.reportProgress?.({ stage: 'agent_request_completed', message: `Vantage ${kind} agent request completed.` });
		} finally {
			this.currentSubmission = previousSubmission;
			clearTimeout(timeout);
			context.signal?.removeEventListener('abort', abortListener);
			unsubscribe();
			if (transient) {
				session.dispose();
			} else {
				this.store.end();
			}
		}
	}

	private async createTransientSession(params: BaseRequestParams, customTools: ToolDefinition[]): Promise<AgentSession> {
		const piAgent = await importCodingAgent();
		const authStorage = piAgent.AuthStorage.create();
		const resolvedApiKey = this.options.apiKey && this.options.apiKey.trim().length > 0
			? this.options.apiKey
			: await this.credentialResolver.resolveApiKey({
				provider: this.provider,
				auth: this.auth,
				workspaceRoot: workspaceRoot(params),
			});
		if (resolvedApiKey) {
			authStorage.setRuntimeApiKey(this.provider, resolvedApiKey);
		}
		const modelRegistry = piAgent.ModelRegistry.create(authStorage);
		const model = modelRegistry.find(this.provider, this.model);
		if (!model) {
			throw new Error(`Unknown Pi model "${this.provider}/${this.model}".`);
		}
		const { session } = await piAgent.createAgentSession({
			cwd: workspaceRoot(params),
			authStorage,
			modelRegistry,
			model: model as Model<never>,
			thinkingLevel: this.options.reasoning,
			tools: ['submit_annotations'],
			customTools,
			sessionManager: piAgent.SessionManager.inMemory(workspaceRoot(params)),
		});
		return session;
	}

	private async submissionTools(): Promise<ToolDefinition[]> {
		const piAgent = await importCodingAgent();
		const piAi = await importPiAi();
		const Type = piAi.Type;
		const submitSearch = piAgent.defineTool({
			name: 'submit_search_results',
			label: 'Submit Search Results',
			description: 'Submit the final curated Vantage search locations. Call exactly once after searching.',
			parameters: Type.Object({
				locations: Type.Array(Type.Object({
					filePath: Type.String({ description: 'Workspace-relative file path.' }),
					startLine: Type.Number({ description: '1-based start line.' }),
					startCharacter: Type.Number({ description: '1-based start character.' }),
					lineCount: Type.Optional(Type.Number({ description: 'Number of lines covered.' })),
					explanation: Type.String({ description: 'Concise single-line explanation for quickfix.' }),
				})),
			}),
			executionMode: 'sequential' as const,
			execute: async (_toolCallId, payload) => {
				const submission = this.requireSubmission('submit_search_results');
				const record = requireRecord(payload, 'submit_search_results');
				const locations = record.locations;
				if (!Array.isArray(locations)) {
					throw new Error('submit_search_results.locations must be an array.');
				}
				const validation = validateSearchLocations(workspaceRoot(submission.params), locations);
				if (!validation.ok) {
					throw new Error(validation.message);
				}
				submission.handlers.onSearch?.(validation.locations);
				return {
					content: [{ type: 'text' as const, text: `Accepted ${validation.locations.length} Vantage search result(s).` }],
					details: { locations: validation.locations },
					terminate: true,
				};
			},
		});
		const submitEdit = piAgent.defineTool({
			name: 'submit_edit',
			label: 'Submit Edit',
			description: 'Submit the complete replacement text for the requested Vantage edit scope.',
			parameters: Type.Object({ replacementText: Type.String() }),
			executionMode: 'sequential' as const,
			execute: async (_toolCallId, payload) => {
				const submission = this.requireSubmission('submit_edit');
				const record = requireRecord(payload, 'submit_edit');
				const replacementText = parseEditPayload(record.replacementText);
				submission.handlers.onEdit?.(replacementText);
				return {
					content: [{ type: 'text' as const, text: 'Accepted Vantage edit replacement text.' }],
					details: { replacementText },
					terminate: true,
				};
			},
		});
		const submitAnnotations = piAgent.defineTool({
			name: 'submit_annotations',
			label: 'Submit Annotations',
			description: 'Submit final Vantage annotation blocks for the requested scope.',
			parameters: Type.Object({ annotations: Type.Array(Type.Unknown()) }),
			executionMode: 'sequential' as const,
			execute: async (_toolCallId, payload) => {
				const submission = this.requireSubmission('submit_annotations');
				const record = requireRecord(payload, 'submit_annotations');
				if (!isAnnotateParams(submission.params)) {
					throw new Error('submit_annotations can only be used for annotate requests.');
				}
				const annotations = parseAnnotationPayload(record.annotations, submission.params);
				submission.handlers.onAnnotations?.(annotations);
				return {
					content: [{ type: 'text' as const, text: `Accepted ${annotations.length} Vantage annotation(s).` }],
					details: { annotations },
					terminate: true,
				};
			},
		});
		return [submitSearch, submitEdit, submitAnnotations];
	}

	private requireSubmission(toolName: string): SubmissionContext {
		if (!this.currentSubmission) {
			throw new Error(`${toolName} was called outside an active Vantage submit request.`);
		}
		return this.currentSubmission;
	}
}

function workspaceRoot(params: BaseRequestParams): string {
	return params.workspaceRoot && params.workspaceRoot.trim().length > 0 ? params.workspaceRoot : path.dirname(params.filePath);
}

function assistantText(message: { content?: unknown[] }): string {
	return (message.content ?? [])
		.filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('\n');
}

function parseSearchFallback(workspaceRootPath: string, text: string): SearchLocation[] {
	const value = parseAssistantJson(text, 'Vantage search fallback');
	if (!isRecord(value) || !Array.isArray(value.locations)) {
		throw new Error('Vantage search fallback JSON must be an object with a locations array.');
	}
	const validation = validateSearchLocations(workspaceRootPath, value.locations);
	if (!validation.ok) {
		throw new Error(validation.message);
	}
	return validation.locations;
}

function parseAssistantJson(text: string, label: string): unknown {
	const trimmed = text.trim();
	const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
	const candidate = fence ? fence[1].trim() : trimmed;
	try {
		return JSON.parse(candidate);
	} catch (error) {
		const start = candidate.indexOf('{');
		const end = candidate.lastIndexOf('}');
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(candidate.slice(start, end + 1));
			} catch {
				// Fall through to the original parse error for a clearer message.
			}
		}
		throw new Error(`${label} did not return valid JSON: ${errorMessage(error)}`);
	}
}

function validateSearchLocations(workspaceRootPath: string, rawLocations: unknown[]): { ok: true; locations: SearchLocation[] } | { ok: false; message: string } {
	const errors: string[] = [];
	const locations: SearchLocation[] = [];
	const seen = new Set<string>();
	if (!Array.isArray(rawLocations)) {
		return { ok: false, message: 'Invalid search results: locations must be an array.' };
	}
	for (const [index, raw] of rawLocations.entries()) {
		const label = `locations[${index}]`;
		if (!isRecord(raw)) {
			errors.push(`${label}: must be an object.`);
			continue;
		}
		const filePath = typeof raw.filePath === 'string' ? raw.filePath : '';
		const startLine = raw.startLine;
		const startCharacter = raw.startCharacter;
		const lineCount = raw.lineCount;
		const explanation = typeof raw.explanation === 'string' ? raw.explanation : '';
		if (filePath.length === 0 || path.isAbsolute(filePath) || filePath.includes('..')) {
			errors.push(`${label}.filePath: must be a workspace-relative path without '..'.`);
			continue;
		}
		const absolutePath = path.resolve(workspaceRootPath, filePath);
		const relative = path.relative(workspaceRootPath, absolutePath);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			errors.push(`${label}.filePath: must be under the workspace root.`);
			continue;
		}
		if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
			errors.push(`${label}.filePath: file does not exist under the workspace root.`);
			continue;
		}
		const fileLineCount = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/).length;
		if (!Number.isInteger(startLine) || Number(startLine) < 1 || Number(startLine) > fileLineCount) {
			errors.push(`${label}.startLine: must be a 1-based line within file length ${fileLineCount}.`);
		}
		if (!Number.isInteger(startCharacter) || Number(startCharacter) < 1) {
			errors.push(`${label}.startCharacter: must be a 1-based positive integer.`);
		}
		if (lineCount !== undefined && (!Number.isInteger(lineCount) || Number(lineCount) < 1)) {
			errors.push(`${label}.lineCount: must be a positive integer when provided.`);
		}
		if (explanation.trim().length === 0) {
			errors.push(`${label}.explanation: must be non-empty.`);
		} else if (/\r|\n/.test(explanation)) {
			errors.push(`${label}.explanation: must be a single-line string.`);
		}
		const key = `${filePath}:${String(startLine)}:${String(startCharacter)}`;
		if (seen.has(key)) {
			errors.push(`${label}: duplicate location ${key}.`);
		}
		seen.add(key);
		if (errors.length === 0 || !errors.some((error) => error.startsWith(label))) {
			locations.push({
				filePath,
				startLine: Number(startLine),
				startCharacter: Number(startCharacter),
				lineCount: lineCount === undefined ? undefined : Number(lineCount),
				explanation: explanation.trim(),
			});
		}
	}
	if (errors.length > 0) {
		return {
			ok: false,
			message: [
				'Invalid search results:',
				...errors.map((error) => `- ${error}`),
				'Please call submit_search_results again with corrected final results only.',
			].join('\n'),
		};
	}
	return { ok: true, locations };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value;
}

function isAnnotateParams(params: BaseRequestParams): params is import('./protocol').AnnotateRangeParams {
	return typeof (params as { scopeText?: unknown }).scopeText === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadCodingAgentModuleForTest(): Promise<CodingAgentModule> {
	return importCodingAgent();
}

async function importCodingAgent(): Promise<CodingAgentModule> {
	const dynamicImport = new Function('specifier', 'return import(specifier)') as (
		specifier: string
	) => Promise<CodingAgentModule>;
	return dynamicImport('@earendil-works/pi-coding-agent');
}

async function importPiAi(): Promise<PiAiModule> {
	const dynamicImport = new Function('specifier', 'return import(specifier)') as (
		specifier: string
	) => Promise<PiAiModule>;
	return dynamicImport('@earendil-works/pi-ai');
}

export function codingAgentErrorMessage(error: unknown): string {
	return errorMessage(error);
}
