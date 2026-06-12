import { isBackendMethod } from './backend-command';

export type LensMode = 'learning' | 'review' | 'general';

export interface Lens {
	mode: LensMode;
	text?: string;
}

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

export interface AnnotationCandidateLine {
	line: number;
	text: string;
}

export interface GitContext {
	branch?: string;
	repositoryRoot?: string;
	currentHunk?: string;
	touchedFiles?: string[];
}

export interface AgentContext {
	path: string;
	content: string;
	revision?: string;
	modifiedAt?: string;
	ageMs?: number;
	truncated: boolean;
}

export interface BaseRequestParams {
	workspaceRoot?: string;
	filePath: string;
	language: string;
	text: string;
	cursor: Position;
	lens?: Lens;
	git?: GitContext;
	agentContext?: AgentContext;
}

export interface ExplainSelectionParams extends BaseRequestParams {
	selectedText: string;
}

export interface QuestionSelectionParams extends BaseRequestParams {
	selectedText: string;
	question: string;
}

export interface EditSelectionParams extends BaseRequestParams {
	range: Range;
	selectedText: string;
	instruction: string;
}

export interface AnnotateRangeParams extends BaseRequestParams {
	visibleRange?: Range;
	range?: Range;
	scopeText: string;
	maxAnnotations?: number;
	candidateLines?: AnnotationCandidateLine[];
}

export interface SearchLocationsParams extends BaseRequestParams {
	query: string;
	selectedText?: string;
	range?: Range;
}

export type AgentRuntimeName = 'pi' | 'development';
export type AgentReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AgentOptionsConfig {
	apiKey?: string;
	temperature?: number;
	maxTokens?: number;
	timeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
	reasoning?: AgentReasoningLevel;
	metadata?: Record<string, unknown>;
	headers?: Record<string, string>;
}

export interface AgentAuthConfig {
	path?: string;
}

export interface AgentSessionOutputConfig {
	history_limit?: number;
}

export interface AgentRuntimeConfig {
	runtime?: AgentRuntimeName;
	provider?: string;
	model?: string;
	auth?: AgentAuthConfig;
	options?: AgentOptionsConfig;
	session_output?: AgentSessionOutputConfig;
}

export interface CommandConfig {
	include_lens?: boolean;
	options?: AgentOptionsConfig;
}

export type SearchCommandConfig = CommandConfig;

export interface AnnotateCommandConfig extends CommandConfig {
	waiting_message_ms?: number;
}

export interface CommandsConfig {
	explain?: CommandConfig;
	question?: CommandConfig;
	edit?: CommandConfig;
	annotate?: AnnotateCommandConfig;
	search?: SearchCommandConfig;
}

export interface BackendRequestConfig {
	agent?: AgentRuntimeConfig;
	commands?: CommandsConfig;
}

export type BackendMethod =
	| 'explainSelection'
	| 'questionSelection'
	| 'editSelection'
	| 'annotateRange'
	| 'searchLocations'
	| 'agentCancel'
	| 'agentSessionReset'
	| 'agentSessionStatus'
	| 'agentSessionOutput'
	| 'listSkills';

export interface AgentSessionOutputParams extends BaseRequestParams {
	raw?: boolean;
}

export type BackendRequest =
	| { id: string; method: 'explainSelection'; config?: BackendRequestConfig; params: ExplainSelectionParams }
	| { id: string; method: 'questionSelection'; config?: BackendRequestConfig; params: QuestionSelectionParams }
	| { id: string; method: 'editSelection'; config?: BackendRequestConfig; params: EditSelectionParams }
	| { id: string; method: 'annotateRange'; config?: BackendRequestConfig; params: AnnotateRangeParams }
	| { id: string; method: 'searchLocations'; config?: BackendRequestConfig; params: SearchLocationsParams }
	| { id: string; method: 'agentCancel'; config?: BackendRequestConfig; params: BaseRequestParams }
	| { id: string; method: 'agentSessionReset'; config?: BackendRequestConfig; params: BaseRequestParams }
	| { id: string; method: 'agentSessionStatus'; config?: BackendRequestConfig; params: BaseRequestParams }
	| { id: string; method: 'agentSessionOutput'; config?: BackendRequestConfig; params: AgentSessionOutputParams }
	| { id: string; method: 'listSkills'; config?: BackendRequestConfig; params: BaseRequestParams };

export interface ExplanationResult {
	kind: 'explanation';
	markdown: string;
}

export interface Annotation {
	range: Range;
	text: string;
	severity: 'info' | 'warning';
	detailMarkdown?: string;
}

export interface AnnotationResult {
	kind: 'annotations';
	annotations: Annotation[];
	telemetry?: AgentRuntimeTelemetry;
}

export interface EditResult {
	kind: 'edit';
	replacementText: string;
	telemetry?: AgentRuntimeTelemetry;
}

export interface SearchLocation {
	filePath: string;
	startLine: number;
	startCharacter: number;
	lineCount?: number;
	explanation: string;
}

export interface SearchLocationsResult {
	kind: 'locations';
	locations: SearchLocation[];
	telemetry?: AgentRuntimeTelemetry;
}

export interface SkillSummary {
	name: string;
	description: string;
	filePath: string;
	source?: string;
}

export interface SkillDiagnosticSummary {
	message: string;
	severity?: string;
}

export interface ListSkillsResult {
	kind: 'skills';
	skills: SkillSummary[];
	diagnostics?: SkillDiagnosticSummary[];
}

export interface AgentRuntimeTelemetry {
	runtime: string;
	model?: string;
	promptChars?: number;
	promptLines?: number;
	elapsedMs?: number;
	totalDurationMs?: number;
	promptEvalCount?: number;
	evalCount?: number;
}

export interface AgentRuntimeProgress {
	stage: string;
	message?: string;
	details?: Record<string, unknown>;
}

export type BackendResult = ExplanationResult | AnnotationResult | EditResult | SearchLocationsResult | ListSkillsResult;

export type BackendResponse =
	| { id: string; ok: true; result: BackendResult }
	| { id: string; ok: false; error: { code: string; message: string } };

type UnknownRecord = Record<string, unknown>;

export function parseBackendRequest(value: unknown): BackendRequest {
	const record = asRecord(value, 'request');
	const id = requireNonEmptyString(record.id, 'request id');
	const method = parseMethod(record.method);
	const config = parseOptionalRequestConfig(record.config, 'request config');
	const params = asRecord(record.params, 'request params');

	switch (method) {
		case 'explainSelection':
			return {
				id,
				method,
				config,
				params: {
					...parseBaseRequestParams(params),
					selectedText: requireString(params.selectedText, 'params.selectedText'),
				},
			};
		case 'questionSelection':
			return {
				id,
				method,
				config,
				params: {
					...parseBaseRequestParams(params),
					selectedText: requireString(params.selectedText, 'params.selectedText'),
					question: requireNonEmptyString(params.question, 'params.question'),
				},
			};
		case 'editSelection':
			return {
				id,
				method,
				config,
				params: {
					...parseBaseRequestParams(params),
					range: parseRange(params.range, 'params.range'),
					selectedText: requireString(params.selectedText, 'params.selectedText'),
					instruction: requireNonEmptyString(params.instruction, 'params.instruction'),
				},
			};
		case 'annotateRange':
			return {
				id,
				method,
				config,
				params: {
					...parseBaseRequestParams(params),
					visibleRange: parseOptionalRange(params.visibleRange, 'params.visibleRange'),
					range: parseOptionalRange(params.range, 'params.range'),
					scopeText: requireString(params.scopeText, 'params.scopeText'),
					maxAnnotations: parseOptionalPositiveInteger(params.maxAnnotations, 'params.maxAnnotations'),
					candidateLines: parseOptionalCandidateLines(params.candidateLines, 'params.candidateLines'),
				},
			};
		case 'searchLocations':
			return {
				id,
				method,
				config,
				params: {
					...parseBaseRequestParams(params),
					query: requireNonEmptyString(params.query, 'params.query'),
					selectedText: parseOptionalString(params.selectedText, 'params.selectedText'),
					range: parseOptionalRange(params.range, 'params.range'),
				},
			};
		case 'agentCancel':
		case 'agentSessionReset':
		case 'agentSessionStatus':
		case 'listSkills':
			return {
				id,
				method,
				config,
				params: parseBaseRequestParams(params),
			};
		case 'agentSessionOutput':
			return {
				id,
				method,
				config,
				params: {
					...parseBaseRequestParams(params),
					raw: parseOptionalBoolean(params.raw, 'params.raw'),
				},
			};
	}
}

function parseOptionalRequestConfig(value: unknown, label: string): BackendRequestConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	return {
		agent: parseOptionalAgentRuntimeConfig(record.agent, `${label}.agent`),
		commands: parseOptionalCommandsConfig(record.commands, `${label}.commands`),
	};
}

function parseOptionalAgentRuntimeConfig(value: unknown, label: string): AgentRuntimeConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: AgentRuntimeConfig = {};
	assignDefined(parsed, 'runtime', parseOptionalAgentRuntimeName(record.runtime, `${label}.runtime`));
	assignDefined(parsed, 'provider', parseOptionalString(record.provider, `${label}.provider`));
	assignDefined(parsed, 'model', parseOptionalString(record.model, `${label}.model`));
	assignDefined(parsed, 'auth', parseOptionalAgentAuthConfig(record.auth, `${label}.auth`));
	assignDefined(parsed, 'options', parseOptionalAgentOptionsConfig(record.options, `${label}.options`));
	assignDefined(parsed, 'session_output', parseOptionalAgentSessionOutputConfig(record.session_output, `${label}.session_output`));
	return parsed;
}

function parseOptionalAgentAuthConfig(value: unknown, label: string): AgentAuthConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: AgentAuthConfig = {};
	assignDefined(parsed, 'path', parseOptionalString(record.path, `${label}.path`));
	return parsed;
}

function parseOptionalAgentSessionOutputConfig(value: unknown, label: string): AgentSessionOutputConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: AgentSessionOutputConfig = {};
	assignDefined(parsed, 'history_limit', parseOptionalPositiveInteger(record.history_limit, `${label}.history_limit`));
	return parsed;
}

function parseOptionalCommandsConfig(value: unknown, label: string): CommandsConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: CommandsConfig = {};
	assignDefined(parsed, 'explain', parseOptionalCommandConfig(record.explain, `${label}.explain`));
	assignDefined(parsed, 'question', parseOptionalCommandConfig(record.question, `${label}.question`));
	assignDefined(parsed, 'edit', parseOptionalCommandConfig(record.edit, `${label}.edit`));
	assignDefined(parsed, 'annotate', parseOptionalAnnotateCommandConfig(record.annotate, `${label}.annotate`));
	assignDefined(parsed, 'search', parseOptionalSearchCommandConfig(record.search, `${label}.search`));
	return parsed;
}

function parseOptionalCommandConfig(value: unknown, label: string): CommandConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: CommandConfig = {
		options: parseOptionalAgentOptionsConfig(record.options, `${label}.options`),
	};
	assignDefined(parsed, 'include_lens', parseOptionalBoolean(record.include_lens, `${label}.include_lens`));
	return parsed;
}

function parseOptionalSearchCommandConfig(value: unknown, label: string): SearchCommandConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: SearchCommandConfig = {
		options: parseOptionalAgentOptionsConfig(record.options, `${label}.options`),
	};
	assignDefined(parsed, 'include_lens', parseOptionalBoolean(record.include_lens, `${label}.include_lens`));
	return parsed;
}

function parseOptionalAnnotateCommandConfig(value: unknown, label: string): AnnotateCommandConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: AnnotateCommandConfig = {
		waiting_message_ms: parseOptionalNonNegativeInteger(record.waiting_message_ms, `${label}.waiting_message_ms`),
		options: parseOptionalAgentOptionsConfig(record.options, `${label}.options`),
	};
	assignDefined(parsed, 'include_lens', parseOptionalBoolean(record.include_lens, `${label}.include_lens`));
	return parsed;
}

function parseOptionalAgentOptionsConfig(value: unknown, label: string): AgentOptionsConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: AgentOptionsConfig = {};
	assignDefined(parsed, 'apiKey', parseOptionalString(record.apiKey, `${label}.apiKey`));
	assignDefined(parsed, 'temperature', parseOptionalNonNegativeNumber(record.temperature, `${label}.temperature`));
	assignDefined(parsed, 'maxTokens', parseOptionalPositiveInteger(record.maxTokens, `${label}.maxTokens`));
	assignDefined(parsed, 'timeoutMs', parseOptionalPositiveInteger(record.timeoutMs, `${label}.timeoutMs`));
	assignDefined(parsed, 'maxRetries', parseOptionalNonNegativeInteger(record.maxRetries, `${label}.maxRetries`));
	assignDefined(parsed, 'maxRetryDelayMs', parseOptionalNonNegativeInteger(record.maxRetryDelayMs, `${label}.maxRetryDelayMs`));
	assignDefined(parsed, 'reasoning', parseOptionalAgentReasoningLevel(record.reasoning, `${label}.reasoning`));
	assignDefined(parsed, 'metadata', parseOptionalUnknownRecord(record.metadata, `${label}.metadata`));
	assignDefined(parsed, 'headers', parseOptionalStringRecord(record.headers, `${label}.headers`));
	return parsed;
}

function parseOptionalAgentRuntimeName(value: unknown, label: string): AgentRuntimeName | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (value === 'pi' || value === 'development') {
		return value;
	}

	throw new Error(`${label} must be pi or development`);
}

function parseOptionalAgentReasoningLevel(value: unknown, label: string): AgentReasoningLevel | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
		return value;
	}

	throw new Error(`${label} must be minimal, low, medium, high, or xhigh`);
}

function parseOptionalCandidateLines(value: unknown, label: string): AnnotationCandidateLine[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}

	return value.map((item, index) => {
		const record = asRecord(item, `${label}[${index}]`);
		return {
			line: requireCoordinate(record.line, `${label}[${index}].line`),
			text: requireString(record.text, `${label}[${index}].text`),
		};
	});
}

function parseBaseRequestParams(params: UnknownRecord): BaseRequestParams {
	return {
		workspaceRoot: parseOptionalString(params.workspaceRoot, 'params.workspaceRoot'),
		filePath: requireString(params.filePath, 'params.filePath'),
		language: requireString(params.language, 'params.language'),
		text: requireString(params.text, 'params.text'),
		cursor: parsePosition(params.cursor, 'params.cursor'),
		lens: parseOptionalLens(params.lens, 'params.lens'),
		git: parseOptionalGitContext(params.git, 'params.git'),
		agentContext: parseOptionalAgentContext(params.agentContext, 'params.agentContext'),
	};
}

function parseMethod(value: unknown): BackendMethod {
	if (isBackendMethod(value)) {
		return value;
	}

	throw new Error('unsupported method');
}

function parseOptionalLens(value: unknown, label: string): Lens | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const mode = record.mode;
	if (mode !== 'learning' && mode !== 'review' && mode !== 'general') {
		throw new Error(`${label}.mode must be learning, review, or general`);
	}

	return {
		mode,
		text: parseOptionalString(record.text, `${label}.text`),
	};
}

function parsePosition(value: unknown, label: string): Position {
	const record = asRecord(value, label);
	return {
		line: requireCoordinate(record.line, `${label}.line`),
		character: requireCoordinate(record.character, `${label}.character`),
	};
}

function parseOptionalRange(value: unknown, label: string): Range | undefined {
	if (value === undefined) {
		return undefined;
	}

	return parseRange(value, label);
}

function parseRange(value: unknown, label: string): Range {
	const record = asRecord(value, label);
	return {
		startLine: requireCoordinate(record.startLine, `${label}.startLine`),
		startCharacter: requireCoordinate(record.startCharacter, `${label}.startCharacter`),
		endLine: requireCoordinate(record.endLine, `${label}.endLine`),
		endCharacter: requireCoordinate(record.endCharacter, `${label}.endCharacter`),
	};
}

function parseOptionalGitContext(value: unknown, label: string): GitContext | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsedTouchedFiles: string[] | undefined = parseOptionalStringArray(
		record.touchedFiles,
		`${label}.touchedFiles`
	);

	return {
		branch: parseOptionalString(record.branch, `${label}.branch`),
		repositoryRoot: parseOptionalString(record.repositoryRoot, `${label}.repositoryRoot`),
		currentHunk: parseOptionalString(record.currentHunk, `${label}.currentHunk`),
		touchedFiles: parsedTouchedFiles,
	};
}

function parseOptionalAgentContext(value: unknown, label: string): AgentContext | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	return {
		path: requireString(record.path, `${label}.path`),
		content: requireString(record.content, `${label}.content`),
		revision: parseOptionalString(record.revision, `${label}.revision`),
		modifiedAt: parseOptionalString(record.modifiedAt, `${label}.modifiedAt`),
		ageMs: parseOptionalNonNegativeNumber(record.ageMs, `${label}.ageMs`),
		truncated: requireBoolean(record.truncated, `${label}.truncated`),
	};
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new Error(`${label} must be an array of strings`);
	}

	return value;
}

function parseOptionalNonNegativeNumber(value: unknown, label: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`${label} must be a non-negative number`);
	}

	return value;
}

function parseOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}

	return value;
}

function parseOptionalUnknownRecord(value: unknown, label: string): Record<string, unknown> | undefined {
	if (value === undefined) {
		return undefined;
	}

	return { ...asRecord(value, label) };
}

function parseOptionalStringRecord(value: unknown, label: string): Record<string, string> | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	for (const [key, recordValue] of Object.entries(record)) {
		if (typeof recordValue !== 'string') {
			throw new Error(`${label}.${key} must be a string`);
		}
	}

	return { ...record } as Record<string, string>;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean`);
	}

	return value;
}

function parseOptionalBoolean(value: unknown, label: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean`);
	}

	return value;
}

function asRecord(value: unknown, label: string): UnknownRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}

	return value as UnknownRecord;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}

	return value;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new Error(`${label} must be a string`);
	}

	return value;
}

function parseOptionalString(value: unknown, label: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	return requireString(value, label);
}

function requireCoordinate(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive 1-based integer`);
	}

	return value;
}

function parseOptionalPositiveInteger(value: unknown, label: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}

	return value;
}

function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
	if (value !== undefined) {
		target[key] = value;
	}
}
