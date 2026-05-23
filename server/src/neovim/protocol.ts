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
	modifiedAt?: string;
	ageMs?: number;
	truncated: boolean;
}

export interface BaseRequestParams {
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

export interface AnnotateRangeParams extends BaseRequestParams {
	visibleRange?: Range;
	range?: Range;
	scopeText: string;
	maxAnnotations?: number;
	candidateLines?: AnnotationCandidateLine[];
}

export interface ReviewCurrentHunkParams extends BaseRequestParams {
	hunkText: string;
}

export type ProviderName = 'fake' | 'codex' | 'ollama' | 'chatgpt' | 'pi';

export interface CodexProviderConfig {
	command?: string;
	model?: string;
	timeout_ms?: number;
	annotation_timeout_ms?: number;
	trace_prompt_path?: string;
	trace_response_path?: string;
}

export interface OllamaProviderConfig {
	base_url?: string;
	model?: string;
	timeout_ms?: number;
	annotation_timeout_ms?: number;
	trace_prompt_path?: string;
	trace_response_path?: string;
}

export interface ChatGptProviderConfig {
	api_key?: string;
	model?: string;
	timeout_ms?: number;
	annotation_timeout_ms?: number;
	trace_prompt_path?: string;
	trace_response_path?: string;
}

export interface PiProviderConfig {
	api_key?: string;
	provider?: string;
	model?: string;
	timeout_ms?: number;
	annotation_timeout_ms?: number;
	trace_prompt_path?: string;
	trace_response_path?: string;
}

export interface BackendProviderConfig {
	name?: ProviderName;
	codex?: CodexProviderConfig;
	ollama?: OllamaProviderConfig;
	chatgpt?: ChatGptProviderConfig;
	pi?: PiProviderConfig;
}

export interface BackendRequestConfig {
	provider?: BackendProviderConfig;
}

export type BackendMethod = 'explainSelection' | 'annotateRange' | 'reviewCurrentHunk';

export type BackendRequest =
	| { id: string; method: 'explainSelection'; config?: BackendRequestConfig; params: ExplainSelectionParams }
	| { id: string; method: 'annotateRange'; config?: BackendRequestConfig; params: AnnotateRangeParams }
	| { id: string; method: 'reviewCurrentHunk'; config?: BackendRequestConfig; params: ReviewCurrentHunkParams };

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
	telemetry?: ProviderTelemetry;
}

export interface ProviderTelemetry {
	provider: string;
	model?: string;
	promptChars?: number;
	promptLines?: number;
	elapsedMs?: number;
	totalDurationMs?: number;
	promptEvalCount?: number;
	evalCount?: number;
}

export interface ReviewFinding {
	range?: Range;
	title: string;
	markdown: string;
	severity: 'info' | 'warning';
}

export interface ReviewResult {
	kind: 'review';
	markdown: string;
	findings: ReviewFinding[];
}

export type BackendResult = ExplanationResult | AnnotationResult | ReviewResult;

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
		case 'reviewCurrentHunk':
			return {
				id,
				method,
				config,
				params: {
					...parseBaseRequestParams(params),
					hunkText: requireString(params.hunkText, 'params.hunkText'),
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
		provider: parseOptionalProviderConfig(record.provider, `${label}.provider`),
	};
}

function parseOptionalProviderConfig(value: unknown, label: string): BackendProviderConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	const parsed: BackendProviderConfig = {};
	assignDefined(parsed, 'name', parseOptionalProviderName(record.name, `${label}.name`));
	assignDefined(parsed, 'codex', parseOptionalCodexProviderConfig(record.codex, `${label}.codex`));
	assignDefined(parsed, 'ollama', parseOptionalOllamaProviderConfig(record.ollama, `${label}.ollama`));
	assignDefined(parsed, 'chatgpt', parseOptionalChatGptProviderConfig(record.chatgpt, `${label}.chatgpt`));
	assignDefined(parsed, 'pi', parseOptionalPiProviderConfig(record.pi, `${label}.pi`));
	return parsed;
}

function parseOptionalCodexProviderConfig(value: unknown, label: string): CodexProviderConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	return {
		command: parseOptionalString(record.command, `${label}.command`),
		model: parseOptionalString(record.model, `${label}.model`),
		timeout_ms: parseOptionalPositiveInteger(record.timeout_ms, `${label}.timeout_ms`),
		annotation_timeout_ms: parseOptionalPositiveInteger(
			record.annotation_timeout_ms,
			`${label}.annotation_timeout_ms`
		),
		trace_prompt_path: parseOptionalString(record.trace_prompt_path, `${label}.trace_prompt_path`),
		trace_response_path: parseOptionalString(record.trace_response_path, `${label}.trace_response_path`),
	};
}

function parseOptionalOllamaProviderConfig(value: unknown, label: string): OllamaProviderConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	return {
		base_url: parseOptionalString(record.base_url, `${label}.base_url`),
		model: parseOptionalString(record.model, `${label}.model`),
		timeout_ms: parseOptionalPositiveInteger(record.timeout_ms, `${label}.timeout_ms`),
		annotation_timeout_ms: parseOptionalPositiveInteger(
			record.annotation_timeout_ms,
			`${label}.annotation_timeout_ms`
		),
		trace_prompt_path: parseOptionalString(record.trace_prompt_path, `${label}.trace_prompt_path`),
		trace_response_path: parseOptionalString(record.trace_response_path, `${label}.trace_response_path`),
	};
}

function parseOptionalChatGptProviderConfig(value: unknown, label: string): ChatGptProviderConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	return {
		api_key: parseOptionalString(record.api_key, `${label}.api_key`),
		model: parseOptionalString(record.model, `${label}.model`),
		timeout_ms: parseOptionalPositiveInteger(record.timeout_ms, `${label}.timeout_ms`),
		annotation_timeout_ms: parseOptionalPositiveInteger(
			record.annotation_timeout_ms,
			`${label}.annotation_timeout_ms`
		),
		trace_prompt_path: parseOptionalString(record.trace_prompt_path, `${label}.trace_prompt_path`),
		trace_response_path: parseOptionalString(record.trace_response_path, `${label}.trace_response_path`),
	};
}

function parseOptionalPiProviderConfig(value: unknown, label: string): PiProviderConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, label);
	return {
		api_key: parseOptionalString(record.api_key, `${label}.api_key`),
		provider: parseOptionalString(record.provider, `${label}.provider`),
		model: parseOptionalString(record.model, `${label}.model`),
		timeout_ms: parseOptionalPositiveInteger(record.timeout_ms, `${label}.timeout_ms`),
		annotation_timeout_ms: parseOptionalPositiveInteger(
			record.annotation_timeout_ms,
			`${label}.annotation_timeout_ms`
		),
		trace_prompt_path: parseOptionalString(record.trace_prompt_path, `${label}.trace_prompt_path`),
		trace_response_path: parseOptionalString(record.trace_response_path, `${label}.trace_response_path`),
	};
}

function parseOptionalProviderName(value: unknown, label: string): ProviderName | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (value === 'fake' || value === 'codex' || value === 'ollama' || value === 'chatgpt' || value === 'pi') {
		return value;
	}

	throw new Error(`${label} must be fake, codex, ollama, chatgpt, or pi`);
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
	if (value === 'explainSelection' || value === 'annotateRange' || value === 'reviewCurrentHunk') {
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

function requireBoolean(value: unknown, label: string): boolean {
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
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
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
