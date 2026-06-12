import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as PiAi from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Annotation, BaseRequestParams, SearchLocation } from './protocol';
import { parseAnnotationPayload, parseEditPayload } from './model-contract';
import { errorMessage } from './effect-errors';

export interface SubmitToolHandlers {
	onSearch?: (locations: SearchLocation[]) => void;
	onEdit?: (replacementText: string) => void;
	onAnnotations?: (annotations: Annotation[]) => void;
}

export interface SubmitToolSubmission {
	params: BaseRequestParams;
	handlers: SubmitToolHandlers;
	outputEntryId?: string;
}

export interface SubmitToolOutputRecorder {
	appendOutputEvent?(entryId: string | undefined, event: { type: string; summary: string; details?: unknown }): void;
}

interface CreateSubmitToolsOptions {
	Type: typeof PiAi.Type;
	defineTool<T extends ToolDefinition>(tool: T): T;
	requireSubmission(toolName: string): SubmitToolSubmission;
	workspaceRoot(params: BaseRequestParams): string;
	output: SubmitToolOutputRecorder;
}

export function createSubmitTools(options: CreateSubmitToolsOptions): ToolDefinition[] {
	const submitSearch = options.defineTool({
		name: 'submit_search_results',
		label: 'Submit Search Results',
		description: 'Submit the final curated Vantage search locations. Call exactly once after searching.',
		parameters: options.Type.Object({
			locations: options.Type.Array(options.Type.Object({
				filePath: options.Type.String({ description: 'Workspace-relative file path.' }),
				startLine: options.Type.Number({ description: '1-based start line.' }),
				startCharacter: options.Type.Number({ description: '1-based start character.' }),
				lineCount: options.Type.Optional(options.Type.Number({ description: 'Number of lines covered.' })),
				explanation: options.Type.String({ description: 'Concise single-line explanation for quickfix.' }),
			})),
		}),
		executionMode: 'sequential' as const,
		execute: async (_toolCallId, payload) => {
			const submission = options.requireSubmission('submit_search_results');
			const record = requireRecord(payload, 'submit_search_results');
			const locations = record.locations;
			if (!Array.isArray(locations)) {
				throw new Error('submit_search_results.locations must be an array.');
			}
			const validation = validateSearchLocations(options.workspaceRoot(submission.params), locations);
			if (!validation.ok) {
				throw new Error(validation.message);
			}
			submission.handlers.onSearch?.(validation.locations);
			options.output.appendOutputEvent?.(submission.outputEntryId, {
				type: 'submit_search_results',
				summary: `Accepted ${validation.locations.length} Vantage search result(s).`,
				details: { locations: validation.locations },
			});
			return {
				content: [{ type: 'text' as const, text: `Accepted ${validation.locations.length} Vantage search result(s).` }],
				details: { locations: validation.locations },
				terminate: true,
			};
		},
	});
	const submitEdit = options.defineTool({
		name: 'submit_edit',
		label: 'Submit Edit',
		description: 'Submit the complete replacement text for the requested Vantage edit scope.',
		parameters: options.Type.Object({ replacementText: options.Type.String() }),
		executionMode: 'sequential' as const,
		execute: async (_toolCallId, payload) => {
			const submission = options.requireSubmission('submit_edit');
			const record = requireRecord(payload, 'submit_edit');
			const replacementText = parseEditPayload(record.replacementText);
			submission.handlers.onEdit?.(replacementText);
			options.output.appendOutputEvent?.(submission.outputEntryId, {
				type: 'submit_edit',
				summary: 'Accepted Vantage edit replacement text.',
				details: { replacementChars: replacementText.length },
			});
			return {
				content: [{ type: 'text' as const, text: 'Accepted Vantage edit replacement text.' }],
				details: { replacementText },
				terminate: true,
			};
		},
	});
	const submitAnnotations = options.defineTool({
		name: 'submit_annotations',
		label: 'Submit Annotations',
		description: 'Submit final Vantage annotation blocks for the requested scope.',
		parameters: options.Type.Object({ annotations: options.Type.Array(options.Type.Unknown()) }),
		executionMode: 'sequential' as const,
		execute: async (_toolCallId, payload) => {
			const submission = options.requireSubmission('submit_annotations');
			const record = requireRecord(payload, 'submit_annotations');
			if (!isAnnotateParams(submission.params)) {
				throw new Error('submit_annotations can only be used for annotate requests.');
			}
			const annotations = parseAnnotationPayload(record.annotations, submission.params);
			submission.handlers.onAnnotations?.(annotations);
			options.output.appendOutputEvent?.(submission.outputEntryId, {
				type: 'submit_annotations',
				summary: `Accepted ${annotations.length} Vantage annotation(s).`,
				details: { annotations },
			});
			return {
				content: [{ type: 'text' as const, text: `Accepted ${annotations.length} Vantage annotation(s).` }],
				details: { annotations },
				terminate: true,
			};
		},
	});
	return [submitSearch, submitEdit, submitAnnotations];
}

export function parseSearchFallback(workspaceRootPath: string, text: string): SearchLocation[] {
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
