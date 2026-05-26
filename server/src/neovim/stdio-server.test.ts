import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as path from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const responseTimeoutMs = 2_000;
const stdoutBuffers = new WeakMap<NodeJS.ReadableStream, string>();

const readJsonLineFromStdout = async (stream: NodeJS.ReadableStream): Promise<Record<string, unknown>> => {
	const chunks: Buffer[] = [];

	while (true) {
		const buffered = stdoutBuffers.get(stream) ?? '';
		const bufferedNewline = buffered.indexOf('\n');
		if (bufferedNewline >= 0) {
			stdoutBuffers.set(stream, buffered.slice(bufferedNewline + 1));
			return JSON.parse(buffered.slice(0, bufferedNewline)) as Record<string, unknown>;
		}

		const [chunk] = await once(stream, 'data') as [Buffer];
		chunks.push(chunk);
		const text = buffered + Buffer.concat(chunks).toString('utf8');
		const newline = text.indexOf('\n');
		if (newline >= 0) {
			stdoutBuffers.set(stream, text.slice(newline + 1));
			return JSON.parse(text.slice(0, newline)) as Record<string, unknown>;
		}
	}
};

const readJsonLine = async (
	child: ChildProcessWithoutNullStreams,
	stderrText: () => string
): Promise<Record<string, unknown>> => {
	let timeout: NodeJS.Timeout | undefined;

	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => {
			reject(new Error(`timed out waiting for stdio server response. stderr: ${stderrText()}`));
		}, responseTimeoutMs);
	});
	const exitPromise = once(child, 'exit').then(([code, signal]) => {
		throw new Error(
			`stdio server exited before writing a response. code: ${String(code)}, signal: ${String(signal)}, stderr: ${stderrText()}`
		);
	}) as Promise<never>;
	const errorPromise = once(child, 'error').then(([error]) => {
		throw new Error(
			`stdio server failed before writing a response: ${error instanceof Error ? error.message : String(error)}. stderr: ${stderrText()}`
		);
	}) as Promise<never>;

	try {
		return await Promise.race([
			readJsonLineFromStdout(child.stdout),
			timeoutPromise,
			exitPromise,
			errorPromise,
		]);
	} finally {
		clearTimeout(timeout);
	}
};

const killAndWait = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}

	const closePromise = once(child, 'close');
	child.kill();
	await closePromise;
};

test('stdio server responds to explainSelection', async () => {
	const serverPath = path.resolve(__dirname, 'stdio-server.js');
	const child = spawn(process.execPath, [serverPath], {
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	const stderrChunks: Buffer[] = [];
	child.stderr.on('data', (chunk: Buffer) => {
		stderrChunks.push(chunk);
	});
	const stderrText = (): string => Buffer.concat(stderrChunks).toString('utf8');

	try {
		child.stdin.write(`${JSON.stringify({
			id: 'req-stdio',
			method: 'explainSelection',
			config: {
				agent: { runtime: 'development' },
			},
			params: {
				filePath: '/repo/example.ex',
				language: 'elixir',
				text: 'defmodule Example do\nend',
				cursor: { line: 0, character: 0 },
				selectedText: 'defmodule Example do\nend',
				lens: { mode: 'learning', text: 'I am learning Elixir syntax' },
			},
		})}\n`);

		let finalResponse = await readJsonLine(child, stderrText);
		let sawBackendProgress = false;
		while (finalResponse.type === 'progress') {
			assert.equal(finalResponse.id, 'req-stdio');
			sawBackendProgress = sawBackendProgress
				|| (finalResponse.progress as { stage?: unknown }).stage === 'backend_received';
			finalResponse = await readJsonLine(child, stderrText);
		}

		assert.equal(sawBackendProgress, true);
		assert.equal(finalResponse.id, 'req-stdio');
		assert.equal(finalResponse.ok, true);
		assert.match(JSON.stringify(finalResponse), /Development agent runtime/);
	} finally {
		await killAndWait(child);
	}
});
