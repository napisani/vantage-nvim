import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as path from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const responseTimeoutMs = 2_000;

const readJsonLineFromStdout = async (stream: NodeJS.ReadableStream): Promise<Record<string, unknown>> => {
	const chunks: Buffer[] = [];

	while (true) {
		const [chunk] = await once(stream, 'data') as [Buffer];
		chunks.push(chunk);
		const text = Buffer.concat(chunks).toString('utf8');
		const newline = text.indexOf('\n');
		if (newline >= 0) {
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
			params: {
				filePath: '/repo/example.ex',
				language: 'elixir',
				text: 'defmodule Example do\nend',
				cursor: { line: 0, character: 0 },
				selectedText: 'defmodule Example do\nend',
				lens: { mode: 'learning', text: 'I am learning Elixir syntax' },
			},
		})}\n`);

		const response = await readJsonLine(child, stderrText);

		assert.equal(response.id, 'req-stdio');
		assert.equal(response.ok, true);
		assert.match(JSON.stringify(response), /Fake provider/);
	} finally {
		await killAndWait(child);
	}
});
