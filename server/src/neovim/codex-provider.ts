import type {
	AnnotateRangeParams,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';
import type { BackendProvider } from './provider';

export interface CodexProviderOptions {
	command?: string;
	model?: string;
}

export class CodexProvider implements BackendProvider {
	readonly command: string;
	readonly model: string;

	constructor(options: CodexProviderOptions = {}) {
		this.command = options.command ?? 'codex';
		this.model = options.model ?? 'gpt-5.4-mini';
	}

	explainSelection(_params: ExplainSelectionParams): ExplanationResult {
		throw new Error('Codex provider is not implemented yet.');
	}

	annotateRange(_params: AnnotateRangeParams): AnnotationResult {
		throw new Error('Codex provider is not implemented yet.');
	}

	reviewCurrentHunk(_params: ReviewCurrentHunkParams): ReviewResult {
		throw new Error('Codex provider is not implemented yet.');
	}
}
