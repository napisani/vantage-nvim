import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as path from 'node:path';

const readJsonLine = async (stream: NodeJS.ReadableStream): Promise<Record<string, unknown>> => {
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

test('stdio server responds to explainSelection', async () => {
	const serverPath = path.resolve(__dirname, 'stdio-server.js');
	const child = spawn(process.execPath, [serverPath], {
		stdio: ['pipe', 'pipe', 'pipe'],
	});

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

	const response = await readJsonLine(child.stdout);
	child.kill();

	assert.equal(response.id, 'req-stdio');
	assert.equal(response.ok, true);
	assert.match(JSON.stringify(response), /Fake provider/);
});
