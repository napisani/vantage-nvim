import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	AnnotateRangeParams,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';
import type { BackendProvider, ProviderRequestContext } from './provider';
import {
	annotationLineOffset,
	buildAnnotationPrompt,
	buildExplainPrompt,
	buildReviewPrompt,
	parseAnnotationResponse,
} from './model-contract';

export interface CodexProviderOptions {
	command?: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	annotationTimeoutMs?: number;
	tracePromptPath?: string;
	traceResponsePath?: string;
}

interface RunCodexOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

interface RunCodexResult {
	content: string;
	telemetry: {
		provider: 'codex';
		model: string;
		promptChars: number;
		promptLines: number;
		elapsedMs: number;
	};
}

export class CodexProvider implements BackendProvider {
	readonly command: string;
	readonly model: string;
	readonly timeoutMs: number;
	readonly annotationTimeoutMs: number;
	readonly tracePromptPath?: string;
	readonly traceResponsePath?: string;
	private readonly env: NodeJS.ProcessEnv;

	constructor(options: CodexProviderOptions = {}) {
		this.command = options.command ?? 'codex';
		this.model = options.model ?? 'gpt-5.4-mini';
		this.env = { ...process.env, ...(options.env ?? {}) };
		this.timeoutMs = options.timeoutMs ?? 300_000;
		this.annotationTimeoutMs = options.annotationTimeoutMs ?? 30_000;
		this.tracePromptPath = options.tracePromptPath;
		this.traceResponsePath = options.traceResponsePath;
	}

	async explainSelection(params: ExplainSelectionParams, context: ProviderRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runCodex(buildExplainPrompt(params), { signal: context.signal });
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async annotateRange(params: AnnotateRangeParams, context: ProviderRequestContext = {}): Promise<AnnotationResult> {
		const { content, telemetry } = await this.runCodex(buildAnnotationPrompt(params), {
			timeoutMs: this.annotationTimeoutMs,
			signal: context.signal,
		});
		return {
			kind: 'annotations',
			annotations: parseAnnotationResponse(content, annotationLineOffset(params), 'Codex', params.candidateLines),
			telemetry,
		};
	}

	async reviewCurrentHunk(params: ReviewCurrentHunkParams, context: ProviderRequestContext = {}): Promise<ReviewResult> {
		const { content: markdown } = await this.runCodex(buildReviewPrompt(params), { signal: context.signal });
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	private async runCodex(prompt: string, options: RunCodexOptions = {}): Promise<RunCodexResult> {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-codex-'));
		const outputPath = path.join(tempDir, 'last-message.md');
		const args = [
			'exec',
			'--ignore-user-config',
			'--model',
			this.model,
			'-C',
			tempDir,
			'--sandbox',
			'read-only',
			'--ephemeral',
			'--ignore-rules',
			'--skip-git-repo-check',
			'--output-last-message',
			outputPath,
			'-',
		];

		try {
			await writeOptionalTrace(this.tracePromptPath, prompt);
			const startedAt = Date.now();
			await runCommand({
				command: this.command,
				args,
				env: this.env,
				input: prompt,
				timeoutMs: options.timeoutMs ?? this.timeoutMs,
				signal: options.signal,
			});

			const content = await fs.readFile(outputPath, 'utf8');
			await writeOptionalTrace(this.traceResponsePath, content);
			if (content.trim().length === 0) {
				throw new Error('Codex produced an empty response.');
			}

			return {
				content: content.trim(),
				telemetry: {
					provider: 'codex',
					model: this.model,
					promptChars: prompt.length,
					promptLines: prompt.split('\n').length,
					elapsedMs: Date.now() - startedAt,
				},
			};
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}
}

async function writeOptionalTrace(filePath: string | undefined, content: string): Promise<void> {
	if (!filePath || filePath.trim() === '') {
		return;
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, 'utf8');
}

interface RunCommandOptions {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	input: string;
	timeoutMs: number;
	signal?: AbortSignal;
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
		const abort = (): void => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);
			child.kill();
			reject(new Error('Codex command cancelled.'));
		};
		if (options.signal?.aborted) {
			abort();
			return;
		}
		options.signal?.addEventListener('abort', abort, { once: true });

		const settle = (callback: () => void): void => {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeout);
			options.signal?.removeEventListener('abort', abort);
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
