import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import type { ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { PiAgentCommon, type PiSessionRequest } from './runtime/pi-agent-common';
import type { AgentSessionHandle, AgentSessionStore } from './runtime/pi/session-store';

function git(root: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: root });
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), 'vantage-diff-tour-runtime-'));
	git(root, 'init', '-q');
	git(root, 'config', 'user.email', 'test@example.com');
	git(root, 'config', 'user.name', 'Test');
	writeFileSync(join(root, 'sample.txt'), 'before\n');
	git(root, 'add', '.');
	git(root, 'commit', '-qm', 'initial');
	writeFileSync(join(root, 'sample.txt'), 'after\n');
	return root;
}

type TestToolArgs = { base: string; target: string } | { file: string } | { points: Array<{
	file: string; side: 'left' | 'right'; line: number; anchor: string; description: string;
}> };

function runtimeFor(root: string, plan: { base: string; target: string }, submit = true, onAccepted?: () => void): PiAgentCommon {
	const store: AgentSessionStore = {
		begin() {}, end() {}, async cancel() { return false; }, async reset() { return false; },
		status() { return { outputHistoryCount: 0, historyLimit: 10, sessionTurnCount: 0 }; },
		renderOutput() { return ''; },
		async getOrCreate(): Promise<AgentSessionHandle> { throw new Error('Unexpected persistent session allocation'); },
	};
	return new PiAgentCommon({ provider: 'test', model: 'test', store,
		sessions: {
			trackRequest: () => true, release() {},
			async acquire(request: PiSessionRequest): Promise<AgentSessionHandle> {
				let active: string[] = [];
				return {
					setActiveToolsByName(names) { active = names; },
					subscribe() { return () => {}; },
					async abort() {}, dispose() {},
					async prompt() {
						const call = async (name: string, args: TestToolArgs) => {
							assert.ok(active.includes(name));
							const tool = request.customTools.find((candidate: ToolDefinition) => candidate.name === name);
							assert.ok(tool, `missing ${name}`);
							// SAFETY: these test tools access only their JSON payload and active submission, not the extension context.
							return tool.execute('test', args, undefined, undefined, {} as ExtensionContext);
						};
						if (active.includes('select_diff_comparison')) {
							await call('select_diff_comparison', plan);
						} else {
							const patch = await call('read_diff_patch', { file: 'sample.txt' });
							assert.match(JSON.stringify(patch.content), /\+after/);
							if (submit) {
								await call('submit_diff_tour', { points: [{
									file: 'sample.txt', side: 'right', line: 1, anchor: 'after', description: 'New behavior.',
								}] });
								onAccepted?.();
							}
						}
					},
				};
			},
		},
	});
}

test('buddy selects a verified comparison, reads a patch, and writes a loadable tour', async () => {
	const root = repo();
	try {
		const result = await runtimeFor(root, { base: 'HEAD', target: 'WORKTREE' }).generateDiffTour({
			workspaceRoot: root, filePath: join(root, 'sample.txt'), language: 'text', text: 'after',
			cursor: { line: 1, character: 1 }, prompt: 'Tour the working changes',
		});
		assert.equal(result.changedFileCount, 1);
		assert.equal(result.inspectedFileCount, 1);
		const artifact = z.object({ version: z.number(), points: z.array(z.object({ side: z.string(), anchor: z.string() })) })
			.parse(JSON.parse(readFileSync(result.path, 'utf8')));
		assert.equal(artifact.version, 1);
		assert.equal(artifact.points[0].side, 'right');
		assert.equal(artifact.points[0].anchor, 'after');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('cancellation after submission still preserves an older tour', async () => {
	const root = repo();
	try {
		const params = { workspaceRoot: root, filePath: join(root, 'sample.txt'), language: 'text', text: '',
			cursor: { line: 1, character: 1 }, prompt: 'Tour the worktree' };
		const first = await runtimeFor(root, { base: 'HEAD', target: 'WORKTREE' }).generateDiffTour(params);
		const original = readFileSync(first.path, 'utf8');
		const controller = new AbortController();
		await assert.rejects(runtimeFor(root, { base: 'HEAD', target: 'WORKTREE' }, true, () => controller.abort())
			.generateDiffTour(params, { signal: controller.signal }));
		assert.equal(readFileSync(first.path, 'utf8'), original);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('comparison conflict and empty submission preserve an older tour', async () => {
	const root = repo();
	const saved = join(root, '.vantage', 'diff-tour.json');
	try {
		const params = { workspaceRoot: root, filePath: join(root, 'sample.txt'), language: 'text', text: '',
			cursor: { line: 1, character: 1 }, prompt: 'Tour the worktree' };
		await runtimeFor(root, { base: 'HEAD', target: 'WORKTREE' }).generateDiffTour(params);
		const original = readFileSync(saved, 'utf8');
		await assert.rejects(runtimeFor(root, { base: 'HEAD', target: 'HEAD' }).generateDiffTour({ ...params, base: 'HEAD' }), /conflicts/);
		await assert.rejects(runtimeFor(root, { base: 'HEAD', target: 'WORKTREE' }, false).generateDiffTour(params), /previous tour preserved/);
		assert.ok(existsSync(saved));
		assert.equal(readFileSync(saved, 'utf8'), original);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
