import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexProvider } from './codex-provider';

async function createCodexStub(): Promise<{ command: string; capturePath: string; cleanup: () => Promise<void> }> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-codex-provider-'));
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
			"  fs.writeFileSync(process.env.LEARN_CODEX_CAPTURE_PATH, JSON.stringify({ argv: process.argv.slice(2), stdin }));",
			"  if (process.env.LEARN_CODEX_STDERR) process.stderr.write(process.env.LEARN_CODEX_STDERR);",
			"  if (process.env.LEARN_CODEX_OUTPUT && outputPath) fs.writeFileSync(outputPath, process.env.LEARN_CODEX_OUTPUT);",
			"  process.exit(Number(process.env.LEARN_CODEX_EXIT || '0'));",
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
				LEARN_CODEX_CAPTURE_PATH: stub.capturePath,
				LEARN_CODEX_OUTPUT: '## Codex explanation\n\nThis is real model text.',
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
		assert.deepEqual(capture.argv.slice(0, 3), ['exec', '--model', 'gpt-5.4-mini-test']);
		assert.equal(capture.argv.includes('--ask-for-approval'), false, capture.argv.join(' '));
		assert.ok(capture.argv.includes('--ephemeral'), capture.argv.join(' '));
		assert.ok(capture.argv.includes('--skip-git-repo-check'), capture.argv.join(' '));
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
				LEARN_CODEX_CAPTURE_PATH: stub.capturePath,
				LEARN_CODEX_OUTPUT: JSON.stringify({
					annotations: [
						{
							range: { startLine: 4, startCharacter: 0, endLine: 4, endCharacter: 16 },
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
	} finally {
		await stub.cleanup();
	}
});

test('CodexProvider annotateRange rejects invalid JSON', async () => {
	const stub = await createCodexStub();
	try {
		const provider = new CodexProvider({
			command: stub.command,
			env: {
				LEARN_CODEX_CAPTURE_PATH: stub.capturePath,
				LEARN_CODEX_OUTPUT: 'not json',
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
				LEARN_CODEX_CAPTURE_PATH: stub.capturePath,
				LEARN_CODEX_EXIT: '7',
				LEARN_CODEX_STDERR: 'not logged in',
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
