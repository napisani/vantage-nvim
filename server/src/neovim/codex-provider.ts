import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	AnnotateRangeParams,
	Annotation,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	Range,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';
import type { BackendProvider } from './provider';

export interface CodexProviderOptions {
	command?: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

export class CodexProvider implements BackendProvider {
	readonly command: string;
	readonly model: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly timeoutMs: number;

	constructor(options: CodexProviderOptions = {}) {
		this.command = options.command ?? 'codex';
		this.model = options.model ?? 'gpt-5.4-mini';
		this.env = { ...process.env, ...(options.env ?? {}) };
		this.timeoutMs = options.timeoutMs ?? 120_000;
	}

	async explainSelection(params: ExplainSelectionParams): Promise<ExplanationResult> {
		const markdown = await this.runCodex(buildExplainPrompt(params));
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async annotateRange(params: AnnotateRangeParams): Promise<AnnotationResult> {
		const content = await this.runCodex(buildAnnotationPrompt(params));
		return {
			kind: 'annotations',
			annotations: parseAnnotationResponse(content),
		};
	}

	async reviewCurrentHunk(params: ReviewCurrentHunkParams): Promise<ReviewResult> {
		const markdown = await this.runCodex(buildReviewPrompt(params));
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	private async runCodex(prompt: string): Promise<string> {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-codex-'));
		const outputPath = path.join(tempDir, 'last-message.md');
		const args = [
			'exec',
			'--model',
			this.model,
			'--sandbox',
			'read-only',
			'--ask-for-approval',
			'never',
			'--ephemeral',
			'--ignore-rules',
			'--skip-git-repo-check',
			'--output-last-message',
			outputPath,
			'-',
		];

		try {
			await runCommand({
				command: this.command,
				args,
				env: this.env,
				input: prompt,
				timeoutMs: this.timeoutMs,
			});

			const content = await fs.readFile(outputPath, 'utf8');
			if (content.trim().length === 0) {
				throw new Error('Codex produced an empty response.');
			}

			return content.trim();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}
}

interface RunCommandOptions {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	input: string;
	timeoutMs: number;
}

async function runCommand(options: RunCommandOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(options.command, options.args, {
			env: options.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let settled = false;

		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}

			settled = true;
			child.kill();
			reject(new Error(`Codex command timed out after ${options.timeoutMs}ms.`));
		}, options.timeoutMs);

		const settle = (callback: () => void): void => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);
			callback();
		};

		child.stdout.on('data', (chunk: Buffer) => {
			stdoutChunks.push(chunk);
		});

		child.stderr.on('data', (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		child.on('error', (error) => {
			settle(() => {
				reject(new Error(`Failed to start Codex command "${options.command}": ${error.message}`));
			});
		});

		child.on('close', (code, signal) => {
			settle(() => {
				if (code === 0) {
					resolve();
					return;
				}

				const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
				const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
				const detail = stderr || stdout || `signal ${String(signal)}`;
				reject(new Error(`Codex command failed with exit code ${String(code)}: ${detail}`));
			});
		});

		child.stdin.end(options.input);
	});
}

function buildExplainPrompt(params: ExplainSelectionParams): string {
	return [
		'You are powering a Neovim code-learning command.',
		'Explain the selected code in concise Markdown.',
		'Focus on the active lens when it is provided.',
		renderRequestContext(params),
		'Selected code:',
		codeBlock(params.language, params.selectedText),
	].join('\n\n');
}

function buildAnnotationPrompt(params: AnnotateRangeParams): string {
	return [
		'You are powering Neovim inline code annotations.',
		'Return only JSON. Do not wrap it in Markdown.',
		'The JSON must be an object with an annotations array.',
		'Each annotation must have range, text, severity, and optional detailMarkdown.',
		'Ranges use zero-based line and character offsets from the file.',
		'Severity must be "info" or "warning".',
		renderRequestContext(params),
		'Code to annotate:',
		codeBlock(params.language, params.scopeText),
		'Expected JSON shape:',
		'{"annotations":[{"range":{"startLine":0,"startCharacter":0,"endLine":0,"endCharacter":10},"text":"Short virtual text","severity":"info","detailMarkdown":"Optional Markdown detail"}]}',
	].join('\n\n');
}

function buildReviewPrompt(params: ReviewCurrentHunkParams): string {
	return [
		'You are powering a Neovim code-review command.',
		'Review the current hunk in concise Markdown.',
		'Focus on correctness, clarity, and the active lens when it is provided.',
		renderRequestContext(params),
		'Hunk:',
		codeBlock(params.language, params.hunkText),
	].join('\n\n');
}

function renderRequestContext(params: {
	filePath: string;
	language: string;
	text: string;
	lens?: { mode: string; text?: string };
}): string {
	const lens = params.lens?.text ? `${params.lens.mode}: ${params.lens.text}` : params.lens?.mode ?? 'general';
	return [
		`File: ${params.filePath}`,
		`Language: ${params.language}`,
		`Lens: ${lens}`,
		`Visible buffer characters: ${params.text.length}`,
	].join('\n');
}

function codeBlock(language: string, content: string): string {
	return ['```' + language, content, '```'].join('\n');
}

function parseAnnotationResponse(content: string): Annotation[] {
	const parsed = parseJsonObject(content);
	const annotations = parsed.annotations;
	if (!Array.isArray(annotations)) {
		throw new Error('Codex annotation response must contain an annotations array.');
	}

	return annotations.map((annotation, index) => parseAnnotation(annotation, index));
}

function parseJsonObject(content: string): Record<string, unknown> {
	const trimmed = content.trim();
	const jsonText = trimmed.startsWith('```') ? extractJsonFence(trimmed) : trimmed;

	try {
		const parsed = JSON.parse(jsonText) as unknown;
		if (!isRecord(parsed)) {
			throw new Error('response was not an object');
		}
		return parsed;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Codex annotation response was not valid JSON: ${message}`);
	}
}

function extractJsonFence(content: string): string {
	const match = content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
	return match ? match[1].trim() : content;
}

function parseAnnotation(value: unknown, index: number): Annotation {
	if (!isRecord(value)) {
		throw new Error(`Codex annotation at index ${index} must be an object.`);
	}

	const range = parseRange(value.range, index);
	const text = value.text;
	if (typeof text !== 'string' || text.trim().length === 0) {
		throw new Error(`Codex annotation at index ${index} must include non-empty text.`);
	}

	const severity = value.severity ?? 'info';
	if (severity !== 'info' && severity !== 'warning') {
		throw new Error(`Codex annotation at index ${index} severity must be "info" or "warning".`);
	}

	const detailMarkdown = value.detailMarkdown;
	if (detailMarkdown !== undefined && typeof detailMarkdown !== 'string') {
		throw new Error(`Codex annotation at index ${index} detailMarkdown must be a string.`);
	}

	return {
		range,
		text,
		severity,
		detailMarkdown,
	};
}

function parseRange(value: unknown, index: number): Range {
	if (!isRecord(value)) {
		throw new Error(`Codex annotation at index ${index} range must be an object.`);
	}

	return {
		startLine: parseCoordinate(value.startLine, index, 'startLine'),
		startCharacter: parseCoordinate(value.startCharacter, index, 'startCharacter'),
		endLine: parseCoordinate(value.endLine, index, 'endLine'),
		endCharacter: parseCoordinate(value.endCharacter, index, 'endCharacter'),
	};
}

function parseCoordinate(value: unknown, index: number, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(`Codex annotation at index ${index} range.${field} must be a non-negative integer.`);
	}

	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
