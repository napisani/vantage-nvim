import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexProvider } from './codex-provider';

async function createCodexStub(): Promise<{ command: string; capturePath: string; cleanup: () => Promise<void> }> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-codex-provider-'));
	const command = path.join(directory, 'codex-stub.js');
	const capturePath = path.join(directory, 'capture.json');
	await fs.writeFile(
		command,
		[
			'#!/usr/bin/env node',
			"const fs = require('node:fs');",
			"const outputIndex = process.argv.indexOf('--output-last-message');",
			"const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : '';",
			"let stdin = '';",
			"process.stdin.setEncoding('utf8');",
			"process.stdin.on('data', chunk => { stdin += chunk; });",
			"process.stdin.on('end', () => {",
			"  fs.writeFileSync(process.env.CODEX_STUB_CAPTURE_PATH, JSON.stringify({ argv: process.argv.slice(2), stdin }));",
			"  if (process.env.CODEX_STUB_STDERR) process.stderr.write(process.env.CODEX_STUB_STDERR);",
			"  if (process.env.CODEX_STUB_OUTPUT && outputPath) fs.writeFileSync(outputPath, process.env.CODEX_STUB_OUTPUT);",
			"  process.exit(Number(process.env.CODEX_STUB_EXIT || '0'));",
			'});',
			'',
		].join('\n')
	);
	await fs.chmod(command, 0o755);

	return {
		command,
		capturePath,
		cleanup: async () => fs.rm(directory, { recursive: true, force: true }),
	};
}

async function readCapture(capturePath: string): Promise<{ argv: string[]; stdin: string }> {
	return JSON.parse(await fs.readFile(capturePath, 'utf8')) as { argv: string[]; stdin: string };
}

test('CodexProvider explainSelection returns final Codex message markdown', async () => {
	const stub = await createCodexStub();
	try {
		const provider = new CodexProvider({
			command: stub.command,
			model: 'gpt-5.4-mini-test',
			env: {
				CODEX_STUB_CAPTURE_PATH: stub.capturePath,
				CODEX_STUB_OUTPUT: '## Codex explanation\n\nThis is real model text.',
			},
		});

		const result = await provider.explainSelection({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 0, character: 0 },
			selectedText: 'const value = 1;',
			lens: { mode: 'learning', text: 'Explain TypeScript syntax' },
		});
		const capture = await readCapture(stub.capturePath);

		assert.equal(result.kind, 'explanation');
		assert.equal(result.markdown, '## Codex explanation\n\nThis is real model text.');
		assert.equal(capture.argv[0], 'exec');
		const modelIndex = capture.argv.indexOf('--model');
		assert.equal(capture.argv[modelIndex + 1], 'gpt-5.4-mini-test');
		assert.equal(capture.argv.includes('--ask-for-approval'), false, capture.argv.join(' '));
		assert.ok(capture.argv.includes('--ephemeral'), capture.argv.join(' '));
		assert.ok(capture.argv.includes('--ignore-user-config'), capture.argv.join(' '));
		assert.ok(capture.argv.includes('--skip-git-repo-check'), capture.argv.join(' '));
		const cdIndex = capture.argv.indexOf('-C');
		assert.notEqual(cdIndex, -1, capture.argv.join(' '));
		assert.match(capture.argv[cdIndex + 1], /vantage-codex-/);
		assert.match(capture.stdin, /explain the selected code/i);
		assert.match(capture.stdin, /const value = 1;/);
	} finally {
		await stub.cleanup();
	}
});

test('CodexProvider annotateRange parses strict annotation JSON', async () => {
	const stub = await createCodexStub();
	try {
		const provider = new CodexProvider({
			command: stub.command,
			env: {
				CODEX_STUB_CAPTURE_PATH: stub.capturePath,
				CODEX_STUB_OUTPUT: JSON.stringify({
					annotations: [
						{
							line: 0,
							text: 'Codex annotation',
							severity: 'warning',
							detailMarkdown: '## Detail\n\nCodex detail.',
						},
					],
				}),
			},
		});

		const result = await provider.annotateRange({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 4, character: 0 },
			visibleRange: { startLine: 4, startCharacter: 0, endLine: 4, endCharacter: 16 },
			scopeText: 'const value = 1;',
			candidateLines: [{ line: 0, text: 'const value = 1;' }],
		});
		const capture = await readCapture(stub.capturePath);

		assert.equal(result.kind, 'annotations');
		assert.deepEqual(result.annotations, [
			{
				range: { startLine: 4, startCharacter: 0, endLine: 4, endCharacter: 16 },
				text: 'Codex annotation',
				severity: 'warning',
				detailMarkdown: '## Detail\n\nCodex detail.',
			},
		]);
		assert.match(capture.stdin, /Return only JSON/i);
		assert.match(capture.stdin, /annotations/);
		assert.match(capture.stdin, /Candidate lines to annotate/i);
	} finally {
		await stub.cleanup();
	}
});

test('CodexProvider converts candidate annotation lines to file lines', async () => {
	const stub = await createCodexStub();
	try {
		const provider = new CodexProvider({
			command: stub.command,
			env: {
				CODEX_STUB_CAPTURE_PATH: stub.capturePath,
				CODEX_STUB_OUTPUT: JSON.stringify({
					annotations: [
						{
							line: 1,
							text: 'Visible snippet annotation',
							severity: 'info',
						},
					],
				}),
			},
		});

		const result = await provider.annotateRange({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const first = 1;\nconst second = first + 1;',
			cursor: { line: 40, character: 0 },
			visibleRange: { startLine: 40, startCharacter: 0, endLine: 41, endCharacter: 25 },
			scopeText: 'const first = 1;\nconst second = first + 1;',
			candidateLines: [
				{ line: 0, text: 'const first = 1;' },
				{ line: 1, text: 'const second = first + 1;' },
			],
		});
		const capture = await readCapture(stub.capturePath);

		assert.deepEqual(result.annotations[0].range, {
			startLine: 41,
			startCharacter: 0,
			endLine: 41,
			endCharacter: 25,
		});
		assert.match(capture.stdin, /Candidate lines to annotate/i);
		assert.match(capture.stdin, /0\| const first = 1;/);
	} finally {
		await stub.cleanup();
	}
});

test('CodexProvider writes prompt and raw response traces when configured', async () => {
	const stub = await createCodexStub();
	const traceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-codex-trace-'));
	const tracePromptPath = path.join(traceDirectory, 'prompt.txt');
	const traceResponsePath = path.join(traceDirectory, 'response.txt');
	try {
		const rawResponse = JSON.stringify({
			annotations: [
				{
					range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 16 },
					text: 'Trace annotation',
					severity: 'info',
				},
			],
		});
		const provider = new CodexProvider({
			command: stub.command,
			tracePromptPath,
			traceResponsePath,
			env: {
				CODEX_STUB_CAPTURE_PATH: stub.capturePath,
				CODEX_STUB_OUTPUT: rawResponse,
			},
		});

		await provider.annotateRange({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 0, character: 0 },
			scopeText: 'const value = 1;',
		});

		const prompt = await fs.readFile(tracePromptPath, 'utf8');
		const response = await fs.readFile(traceResponsePath, 'utf8');
		assert.match(prompt, /Return only JSON/i);
		assert.match(prompt, /const value = 1;/);
		assert.equal(response, rawResponse);
	} finally {
		await stub.cleanup();
		await fs.rm(traceDirectory, { recursive: true, force: true });
	}
});

test('CodexProvider annotateRange rejects invalid JSON', async () => {
	const stub = await createCodexStub();
	try {
		const provider = new CodexProvider({
			command: stub.command,
			env: {
				CODEX_STUB_CAPTURE_PATH: stub.capturePath,
				CODEX_STUB_OUTPUT: 'not json',
			},
		});

		await assert.rejects(
			() =>
				provider.annotateRange({
					filePath: '/repo/example.ts',
					language: 'typescript',
					text: 'const value = 1;',
					cursor: { line: 0, character: 0 },
					scopeText: 'const value = 1;',
				}),
			/Codex annotation response was not valid JSON/
		);
	} finally {
		await stub.cleanup();
	}
});

test('CodexProvider reports non-zero Codex exits', async () => {
	const stub = await createCodexStub();
	try {
		const provider = new CodexProvider({
			command: stub.command,
			env: {
				CODEX_STUB_CAPTURE_PATH: stub.capturePath,
				CODEX_STUB_EXIT: '7',
				CODEX_STUB_STDERR: 'not logged in',
			},
		});

		await assert.rejects(
			() =>
				provider.reviewCurrentHunk({
					filePath: '/repo/example.ts',
					language: 'typescript',
					text: 'const value = 1;',
					cursor: { line: 0, character: 0 },
					hunkText: 'const value = 1;',
				}),
			/Codex command failed with exit code 7: not logged in/
		);
	} finally {
		await stub.cleanup();
	}
});

test('CodexProvider exposes a five-minute default timeout', () => {
	const provider = new CodexProvider();

	assert.equal(provider.timeoutMs, 300_000);
});

test('CodexProvider exposes a shorter annotation timeout', () => {
	const provider = new CodexProvider();

	assert.equal(provider.annotationTimeoutMs, 30_000);
});
