import {
	AnnotateRangeParams,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';
import type { BackendProvider } from './provider';

export class FakeProvider implements BackendProvider {
	explainSelection(params: ExplainSelectionParams): ExplanationResult {
		return {
			kind: 'explanation',
			markdown: [
				'## Explanation',
				'',
				`Fake provider response for **${params.language}**.`,
				renderLens(params.lens),
				renderPreview('Selected preview', params.selectedText),
				contextSummary(params),
			].join('\n'),
		};
	}

	annotateRange(params: AnnotateRangeParams): AnnotationResult {
		const baseLine = params.visibleRange?.startLine ?? params.range?.startLine ?? 0;
		const annotations = params.scopeText
			.split(/\r?\n/)
			.map((line, index) => ({ line, index }))
			.filter(({ line }) => line.trim().length > 0)
			.slice(0, 3)
			.map(({ line, index }) => ({
				range: {
					startLine: baseLine + index,
					startCharacter: 0,
					endLine: baseLine + index,
					endCharacter: line.length,
				},
				text: `Fake provider annotation for ${formatLanguage(params.language)}: ${line.trim()}`,
				severity: 'info' as const,
				detailMarkdown: [
					'## Annotation detail',
					'',
					`Fake provider annotation for ${formatLanguage(params.language)}.`,
					'',
					`Line: \`${line.trim()}\``,
				].join('\n'),
			}));

		return {
			kind: 'annotations',
			annotations,
		};
	}

	reviewCurrentHunk(params: ReviewCurrentHunkParams): ReviewResult {
		const markdown = [
			'## Review',
			'',
			`Fake provider response for **${formatLanguage(params.language)}**.`,
			renderLens(params.lens),
			renderPreview('Hunk preview', params.hunkText),
			contextSummary(params),
		].join('\n');

		return {
			kind: 'review',
			markdown,
			findings: [
				{
					title: 'Fake finding',
					markdown: 'Fake provider finding for the current hunk.',
					severity: 'info',
				},
			],
		};
	}
}

function formatLanguage(language: string): string {
	if (language.length === 0) {
		return 'Unknown';
	}

	return `${language[0].toUpperCase()}${language.slice(1)}`;
}

function renderLens(lens: { mode: string; text?: string } | undefined): string {
	if (!lens) {
		return 'Lens: general';
	}

	return lens.text ? `Lens: ${lens.mode} - ${lens.text}` : `Lens: ${lens.mode}`;
}

function renderPreview(label: string, text: string): string {
	const preview = text.trim().split(/\r?\n/).slice(0, 3).join('\n');
	return `${label}:\n\`\`\`\n${preview}\n\`\`\``;
}

function contextSummary(params: { filePath: string; git?: { branch?: string; touchedFiles?: string[] } }): string {
	const parts = [`file ${params.filePath}`];

	if (params.git?.branch) {
		parts.push(`branch ${params.git.branch}`);
	}

	if (params.git?.touchedFiles?.length) {
		parts.push(`${params.git.touchedFiles.length} touched files`);
	}

	return `Context: ${parts.join(', ')}.`;
}
