import type {
	AnnotateRangeParams,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';

export type ProviderResult<T> = T | Promise<T>;

export interface BackendProvider {
	explainSelection(params: ExplainSelectionParams): ProviderResult<ExplanationResult>;
	annotateRange(params: AnnotateRangeParams): ProviderResult<AnnotationResult>;
	reviewCurrentHunk(params: ReviewCurrentHunkParams): ProviderResult<ReviewResult>;
}
