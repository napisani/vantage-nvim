import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDiffTour, validateDiffTourPoints } from './diff-tour-git';

function git(root: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('commit diff exposes renamed and deleted text, and validates both revision sides', () => {
	const root = mkdtempSync(join(tmpdir(), 'vantage-diff-tour-'));
	try {
		git(root, 'init', '-q');
		git(root, 'config', 'user.email', 'test@example.com');
		git(root, 'config', 'user.name', 'Test');
		writeFileSync(join(root, 'old.txt'), 'before\nretained\n');
		writeFileSync(join(root, 'gone.txt'), 'removed\n');
		git(root, 'add', '.');
		git(root, 'commit', '-qm', 'initial');
		const base = git(root, 'rev-parse', 'HEAD');
		git(root, 'mv', 'old.txt', 'new.txt');
		writeFileSync(join(root, 'new.txt'), 'after\nretained\n');
		git(root, 'rm', '-q', 'gone.txt');
		git(root, 'add', '.');
		git(root, 'commit', '-qm', 'change');
		const tour = openDiffTour(root, 'HEAD~1', 'HEAD');
		assert.equal(tour.comparison.base.commit, base);
		assert.deepEqual(tour.entries.map((entry) => entry.file).sort(), ['gone.txt', 'new.txt']);
		assert.equal(tour.readPatch('gone.txt').patch.includes('-removed'), true);
		assert.equal(tour.readPatch('new.txt').patch.includes('+after'), true);
		assert.equal(tour.readPatch('new.txt').patch.includes('-before'), true);
		assert.deepEqual(validateDiffTourPoints(tour, [
			{ file: 'gone.txt', side: 'left', line: 1, anchor: 'removed', description: 'This file was deleted.' },
			{ file: 'new.txt', side: 'right', line: 2, anchor: 'retained', description: 'Unchanged context in a changed file.' },
		]), [
			{ file: 'gone.txt', side: 'left', line: 1, anchor: 'removed', description: 'This file was deleted.' },
			{ file: 'new.txt', side: 'right', line: 2, anchor: 'retained', description: 'Unchanged context in a changed file.' },
		]);
		assert.throws(() => validateDiffTourPoints(tour, [
			{ file: '../outside.txt', side: 'right', line: 1, anchor: 'x', description: 'Bad path.' },
		]));
		assert.throws(() => validateDiffTourPoints(tour, [
			{ file: 'gone.txt', side: 'right', line: 1, anchor: 'removed', description: 'Wrong side.' },
		]));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('worktree validation does not follow tracked symlinks outside the repository', () => {
	const root = mkdtempSync(join(tmpdir(), 'vantage-diff-tour-'));
	const external = mkdtempSync(join(tmpdir(), 'vantage-private-'));
	try {
		git(root, 'init', '-q');
		git(root, 'config', 'user.email', 'test@example.com');
		git(root, 'config', 'user.name', 'Test');
		writeFileSync(join(root, 'safe.txt'), 'safe\n');
		git(root, 'add', '.');
		git(root, 'commit', '-qm', 'initial');
		writeFileSync(join(external, 'secret.txt'), 'secret\n');
		symlinkSync(join(external, 'secret.txt'), join(root, 'link.txt'));
		git(root, 'add', 'link.txt');
		const tour = openDiffTour(root, 'HEAD');
		assert.deepEqual(tour.entries, []);
		assert.equal(tour.line('link.txt', 'right', 1), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(external, { recursive: true, force: true });
	}
});

test('base-to-worktree includes staged and unstaged tracked changes, not untracked files', () => {
	const root = mkdtempSync(join(tmpdir(), 'vantage-diff-tour-'));
	try {
		git(root, 'init', '-q');
		git(root, 'config', 'user.email', 'test@example.com');
		git(root, 'config', 'user.name', 'Test');
		writeFileSync(join(root, 'staged.txt'), 'old\n');
		writeFileSync(join(root, 'local.txt'), 'old\n');
		writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
		git(root, 'add', '.');
		git(root, 'commit', '-qm', 'initial');
		writeFileSync(join(root, 'staged.txt'), 'staged\n');
		git(root, 'add', 'staged.txt');
		writeFileSync(join(root, 'local.txt'), 'local\n');
		writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 3]));
		writeFileSync(join(root, 'untracked.txt'), 'untracked\n');
		const tour = openDiffTour(root, 'HEAD', 'WORKTREE');
		assert.equal(tour.comparison.target.kind, 'worktree');
		assert.deepEqual(tour.entries.map((entry) => entry.file).sort(), ['local.txt', 'staged.txt']);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
