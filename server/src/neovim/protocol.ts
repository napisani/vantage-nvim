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

export interface BaseRequestParams {
	filePath: string;
	language: string;
	text: string;
	cursor: Position;
	lens?: Lens;
	git?: GitContext;
}

export interface ExplainSelectionParams extends BaseRequestParams {
	selectedText: string;
}

export interface AnnotateRangeParams extends BaseRequestParams {
	visibleRange?: Range;
	range?: Range;
	scopeText: string;
	candidateLines?: AnnotationCandidateLine[];
}

export interface ReviewCurrentHunkParams extends BaseRequestParams {
	hunkText: string;
}

export type BackendMethod = 'explainSelection' | 'annotateRange' | 'reviewCurrentHunk';

export type BackendRequest =
	| { id: string; method: 'explainSelection'; params: ExplainSelectionParams }
	| { id: string; method: 'annotateRange'; params: AnnotateRangeParams }
	| { id: string; method: 'reviewCurrentHunk'; params: ReviewCurrentHunkParams };

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
	const params = asRecord(record.params, 'request params');

	switch (method) {
		case 'explainSelection':
			return {
				id,
				method,
				params: {
					...parseBaseRequestParams(params),
					selectedText: requireString(params.selectedText, 'params.selectedText'),
				},
			};
		case 'annotateRange':
			return {
				id,
				method,
				params: {
					...parseBaseRequestParams(params),
					visibleRange: parseOptionalRange(params.visibleRange, 'params.visibleRange'),
					range: parseOptionalRange(params.range, 'params.range'),
					scopeText: requireString(params.scopeText, 'params.scopeText'),
					candidateLines: parseOptionalCandidateLines(params.candidateLines, 'params.candidateLines'),
				},
			};
		case 'reviewCurrentHunk':
			return {
				id,
				method,
				params: {
					...parseBaseRequestParams(params),
					hunkText: requireString(params.hunkText, 'params.hunkText'),
				},
			};
	}
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

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new Error(`${label} must be an array of strings`);
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
