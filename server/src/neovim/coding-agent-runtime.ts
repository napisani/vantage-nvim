import * as path from 'node:path';
import type { Model } from '@earendil-works/pi-ai';
import type { AgentSession, AuthStorage, DefaultResourceLoader, ModelRegistry, SessionManager, SettingsManager, Skill, ToolDefinition } from '@earendil-works/pi-coding-agent';
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
	AgentSessionOutputConfig,
	AgentSessionOutputParams,
	ListSkillsResult,
} from './protocol';
import {
	buildAnnotationPrompt,
	buildEditPrompt,
	buildExplainPrompt,
	buildQuestionPrompt,
	buildSearchPrompt,
	parseEditPayload,
} from './model-contract';
import { PiOAuthCredentialResolver, type PiCredentialResolver } from './pi-oauth-auth';
import { errorMessage } from './effect-errors';
import { CodingAgentSessionStore } from './coding-agent-session-store';
import { createSubmitTools, parseSearchFallback, type SubmitToolSubmission } from './submit-tools';

export { CodingAgentSessionStore } from './coding-agent-session-store';

interface CommandConfig {
	include_lens?: boolean;
	options?: AgentOptionsConfig;
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
	sessionOutput?: AgentSessionOutputConfig;
	store?: CodingAgentSessionStore;
	credentialResolver?: PiCredentialResolver;
}

interface CodingAgentModule {
	AuthStorage: typeof AuthStorage;
	ModelRegistry: typeof ModelRegistry;
	SessionManager: typeof SessionManager;
	SettingsManager: typeof SettingsManager;
	DefaultResourceLoader: typeof DefaultResourceLoader;
	getAgentDir(): string;
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

type SubmissionContext = SubmitToolSubmission;

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
		this.store.setHistoryLimit?.(options.sessionOutput?.history_limit);
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
				`Session output entries: ${status.outputHistoryCount}`,
			].filter((line): line is string => line !== undefined).join('\n'),
		};
	}

	async agentSessionOutput(params: AgentSessionOutputParams): Promise<ExplanationResult> {
		return {
			kind: 'explanation',
			markdown: this.store.renderOutput(params.raw),
		};
	}

	async listSkills(params: BaseRequestParams): Promise<ListSkillsResult> {
		const piAgent = await importCodingAgent();
		const cwd = workspaceRoot(params);
		const settingsManager = piAgent.SettingsManager.create(cwd, piAgent.getAgentDir());
		const resourceLoader = new piAgent.DefaultResourceLoader({
			cwd,
			agentDir: piAgent.getAgentDir(),
			settingsManager,
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader.reload();
		const result = resourceLoader.getSkills();
		return {
			kind: 'skills',
			skills: result.skills.map(skillSummary),
			diagnostics: result.diagnostics.map((diagnostic) => ({
				message: diagnosticMessage(diagnostic),
				severity: diagnosticSeverity(diagnostic),
			})),
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
		const outputEntryId = this.store.startOutputEntry?.({
			kind,
			transient,
			provider: this.provider,
			model: this.model,
			userSummary: userSummary(kind, params),
			prompt,
		});
		context.reportProgress?.({ stage: 'agent_session_start', message: `Starting Vantage ${kind} agent request.` });
		this.store.appendOutputEvent?.(outputEntryId, { type: 'request_start', summary: `Started ${kind} request.` });
		const customTools = await this.submissionTools();
		const root = workspaceRoot(params);
		const session = transient
			? await this.createTransientSession(params, customTools)
			: await this.store.getOrCreate({
				workspaceRoot: root,
				provider: this.provider,
				model: this.model,
				createSession: () => this.createBuddySession(root, customTools),
			});
		session.setActiveToolsByName(activeTools);

		const abort = async () => {
			await session.abort();
		};
		if (!transient) {
			this.store.begin(kind, abort, outputEntryId);
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
		this.currentSubmission = submission ? { ...submission, outputEntryId } : undefined;
		const unsubscribe = session.subscribe((event) => {
			const eventRecord = event as Record<string, unknown>;
			this.store.appendOutputEvent?.(outputEntryId, {
				type: String(eventRecord.type ?? 'event'),
				summary: eventSummary(eventRecord),
				details: eventRecord,
			});
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
				const text = assistantText(event.message);
				this.store.setAssistantText?.(outputEntryId, text);
				onAssistantText?.(text);
			}
		});
		try {
			await session.prompt(prompt, { source: 'rpc' });
			this.store.finishOutputEntry?.(outputEntryId, 'completed');
			context.reportProgress?.({ stage: 'agent_request_completed', message: `Vantage ${kind} agent request completed.` });
		} catch (error) {
			const status = context.signal?.aborted ? 'cancelled' : 'failed';
			this.store.finishOutputEntry?.(outputEntryId, status, status === 'failed' ? errorMessage(error) : undefined);
			throw error;
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

	private async createBuddySession(root: string, customTools: ToolDefinition[]): Promise<AgentSession> {
		return this.createCodingAgentSession(root, customTools, ['read', 'grep', 'find', 'ls', 'submit_search_results', 'submit_edit', 'submit_annotations']);
	}

	private async createTransientSession(params: BaseRequestParams, customTools: ToolDefinition[]): Promise<AgentSession> {
		return this.createCodingAgentSession(workspaceRoot(params), customTools, ['submit_annotations']);
	}

	private async createCodingAgentSession(root: string, customTools: ToolDefinition[], tools: string[]): Promise<AgentSession> {
		const piAgent = await importCodingAgent();
		const authStorage = piAgent.AuthStorage.create();
		const resolvedApiKey = this.options.apiKey && this.options.apiKey.trim().length > 0
			? this.options.apiKey
			: await this.credentialResolver.resolveApiKey({
				provider: this.provider,
				auth: this.auth,
				workspaceRoot: root,
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
			cwd: root,
			authStorage,
			modelRegistry,
			model: model as Model<never>,
			thinkingLevel: this.options.reasoning,
			tools,
			customTools,
			sessionManager: piAgent.SessionManager.inMemory(root),
		});
		return session;
	}

	private async submissionTools(): Promise<ToolDefinition[]> {
		const piAgent = await importCodingAgent();
		const piAi = await importPiAi();
		return createSubmitTools({
			Type: piAi.Type,
			defineTool: piAgent.defineTool,
			requireSubmission: (toolName) => this.requireSubmission(toolName),
			workspaceRoot,
			output: this.store,
		});
	}

	private requireSubmission(toolName: string): SubmissionContext {
		if (!this.currentSubmission) {
			throw new Error(`${toolName} was called outside an active Vantage submit request.`);
		}
		return this.currentSubmission;
	}
}

function userSummary(kind: string, params: BaseRequestParams): string {
	if (kind === 'question') {
		return truncate((params as QuestionSelectionParams).question ?? '', 160);
	}
	if (kind === 'edit') {
		return truncate((params as EditSelectionParams).instruction ?? '', 160);
	}
	if (kind === 'search') {
		return truncate((params as SearchLocationsParams).query ?? '', 160);
	}
	if (kind === 'annotate') {
		return `${params.filePath} annotation request`;
	}
	return `${params.filePath}:${params.cursor.line}`;
}

function truncate(value: string, max: number): string {
	const text = value.trim().replace(/\s+/g, ' ');
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function eventSummary(event: Record<string, unknown>): string {
	const type = String(event.type ?? 'event');
	const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
	if (toolName && type.includes('tool')) {
		return `${type}: ${toolName}`;
	}
	if (type === 'message_update') {
		return 'assistant response updated';
	}
	if (type === 'message_end') {
		return 'message completed';
	}
	return type;
}

function skillSummary(skill: Skill): { name: string; description: string; filePath: string; source?: string } {
	const source = isRecord(skill.sourceInfo) && typeof skill.sourceInfo.label === 'string'
		? skill.sourceInfo.label
		: undefined;
	return {
		name: skill.name,
		description: skill.description,
		filePath: skill.filePath,
		source,
	};
}

function diagnosticMessage(diagnostic: unknown): string {
	if (isRecord(diagnostic)) {
		if (typeof diagnostic.message === 'string') {
			return diagnostic.message;
		}
		if (typeof diagnostic.detail === 'string') {
			return diagnostic.detail;
		}
	}
	return String(diagnostic);
}

function diagnosticSeverity(diagnostic: unknown): string | undefined {
	return isRecord(diagnostic) && typeof diagnostic.severity === 'string' ? diagnostic.severity : undefined;
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
