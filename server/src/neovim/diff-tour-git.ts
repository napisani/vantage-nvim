import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

export type DiffComparison = {
	vcs: 'git';
	repoRoot: '.';
	base: { label: string; commit: string };
	target: { kind: 'commit'; label: string; commit: string } | { kind: 'worktree'; headAtAuthoring: string };
};
export type DiffTourPoint = { file: string; side: 'left' | 'right'; line: number; anchor: string; description: string };
export type DiffTourArtifact = { version: 1; comparison: DiffComparison; points: DiffTourPoint[] };
export type DiffEntry = { file: string; oldFile?: string; status: 'A' | 'M' | 'D' | 'R'; added: number; removed: number };
export type DiffPatch = { file: string; patch: string; nextOffset?: number };

function git(root: string, args: string[], maxBuffer = 32 * 1024 * 1024): string {
	try {
		return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (error) {
		throw new Error(`Git could not inspect the diff: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function safeDiffPath(file: string): boolean {
	return file !== '' && !path.isAbsolute(file) && !file.includes('\\') &&
		!file.split('/').some((part) => part === '' || part === '.' || part === '..') &&
		![...file].some((character) => character.charCodeAt(0) < 32);
}

const DiffTourPointsSchema = z.array(z.object({
	file: z.string().refine(safeDiffPath), side: z.enum(['left', 'right']),
	line: z.number().int().positive(), anchor: z.string().refine((value) => !/[\r\n]/.test(value)),
	description: z.string().min(1).max(500).refine((value) => !/[\r\n]/.test(value)),
})).min(1).max(100);

function resolveCommit(root: string, label: string): string {
	if (!label || label.startsWith('-') || label.includes('\0') || label.includes('\n')) {
		throw new Error('Invalid Git revision.');
	}
	const hash = git(root, ['rev-parse', '--verify', '--end-of-options', `${label}^{commit}`]).trim();
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) {
		throw new Error(`Could not resolve ${label} to a commit.`);
	}
	return hash;
}

export function openDiffTour(root: string, baseLabel: string, targetLabel: string = 'WORKTREE'): DiffTourSnapshot {
	const repo = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
	if (repo !== fs.realpathSync(root)) {
		throw new Error('The Vantage workspace must be the Git repository root.');
	}
	const base = resolveCommit(repo, baseLabel);
	const target = targetLabel === 'WORKTREE' ? undefined : resolveCommit(repo, targetLabel);
	const comparison: DiffComparison = {
		vcs: 'git', repoRoot: '.', base: { label: baseLabel, commit: base },
		target: target ? { kind: 'commit', label: targetLabel, commit: target } :
			{ kind: 'worktree', headAtAuthoring: resolveCommit(repo, 'HEAD') },
	};
	return new DiffTourSnapshot(repo, comparison);
}

function diffStats(root: string, args: string[]): Map<string, { added: number; removed: number }> {
	const stats = new Map<string, { added: number; removed: number }>();
	const numstat = git(root, ['diff', '--numstat', '-z', '-M', ...args, '--']).split('\0');
	for (let i = 0; i < numstat.length - 1; i++) {
		const [added, removed, candidate] = numstat[i].split('\t');
		if (added === '-' || removed === '-') {
			if (!candidate) { i += 2; }
			continue;
		}
		const file = candidate || numstat[i + 2];
		if (!candidate) { i += 2; }
		if (file) { stats.set(file, { added: Number(added), removed: Number(removed) }); }
	}
	return stats;
}

function regularDiffFiles(root: string, args: string[]): Set<string> {
	const files = new Set<string>();
	const raw = git(root, ['diff', '--raw', '-z', '-M', ...args, '--']).split('\0');
	for (let i = 0; i < raw.length - 1; i++) {
		const header = /^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ ([A-Z])/.exec(raw[i]);
		if (!header) { continue; }
		const old = raw[++i];
		const file = header[3] === 'R' ? raw[++i] : old;
		const oldRegular = header[1] === '100644' || header[1] === '100755' || header[1] === '000000';
		const newRegular = header[2] === '100644' || header[2] === '100755' || header[2] === '000000';
		if (oldRegular && newRegular) { files.add(file); }
	}
	return files;
}

export class DiffTourSnapshot {
	readonly entries: DiffEntry[];
	private readonly byPath: Map<string, DiffEntry>;
	private readonly args: string[];

	constructor(readonly root: string, readonly comparison: DiffComparison) {
		this.args = comparison.target.kind === 'commit' ?
			[`${comparison.base.commit}..${comparison.target.commit}`] : [comparison.base.commit];
		const stats = diffStats(root, this.args);
		const regularFiles = regularDiffFiles(root, this.args);
		const fields = git(root, ['diff', '--name-status', '-z', '-M', ...this.args, '--']).split('\0');
		const entries: DiffEntry[] = [];
		for (let i = 0; i < fields.length - 1; i++) {
			const statusCode = fields[i].charAt(0);
			let status: DiffEntry['status'];
			switch (statusCode) {
				case 'A': status = 'A'; break;
				case 'M': status = 'M'; break;
				case 'D': status = 'D'; break;
				case 'R': status = 'R'; break;
				default: continue;
			}
			const old = fields[++i];
			const file = status === 'R' ? fields[++i] : old;
			const counts = stats.get(file);
			if (!counts || !regularFiles.has(file) || !safeDiffPath(file) || !safeDiffPath(old)) { continue; }
			const entry: DiffEntry = { file, status, ...counts };
			if (status === 'R') { entry.oldFile = old; }
			entries.push(entry);
		}
		this.entries = entries;
		this.byPath = new Map(entries.map((entry) => [entry.file, entry]));
	}

	readPatch(file: string, offset = 0): DiffPatch {
		if (!safeDiffPath(file) || !this.byPath.has(file) || !Number.isSafeInteger(offset) || offset < 0) {
			throw new Error('Patch path or offset is outside the diff manifest.');
		}
		const entry = this.byPath.get(file);
		const paths = entry?.oldFile ? [entry.oldFile, file] : [file];
		const text = git(this.root, ['diff', '--no-ext-diff', '--no-textconv', '-M', '-U3', ...this.args, '--', ...paths], 64 * 1024 * 1024);
		const maxChars = 48 * 1024;
		const page: DiffPatch = { file, patch: text.slice(offset, offset + maxChars) };
		if (offset + maxChars < text.length) { page.nextOffset = offset + maxChars; }
		return page;
	}

	line(file: string, side: 'left' | 'right', number: number): string | undefined {
		const entry = this.byPath.get(file);
		if (!entry || !Number.isSafeInteger(number) || number < 1 ||
			(side === 'left' && entry.status === 'A') || (side === 'right' && entry.status === 'D')) {
			return undefined;
		}
		let commit: string | undefined;
		if (side === 'left') {
			commit = this.comparison.base.commit;
		} else if (this.comparison.target.kind === 'commit') {
			commit = this.comparison.target.commit;
		}
		const blobPath = side === 'left' ? entry.oldFile || file : file;
		if (commit) {
			const mode = git(this.root, ['ls-tree', '-z', commit, '--', blobPath]).slice(0, 6);
			if (mode !== '100644' && mode !== '100755') { return undefined; }
		} else if (!fs.lstatSync(path.join(this.root, file)).isFile()) {
			return undefined;
		}
		const content = commit ? git(this.root, ['show', `${commit}:${blobPath}`]) :
			fs.readFileSync(path.join(this.root, file), 'utf8');
		const lines = content.split('\n');
		if (lines.at(-1) === '') { lines.pop(); }
		return lines[number - 1];
	}
}

export function validateDiffTourPoints(snapshot: DiffTourSnapshot, rawPoints: DiffTourPoint[]): DiffTourPoint[] {
	const points = DiffTourPointsSchema.parse(rawPoints);
	for (const [index, point] of points.entries()) {
		if (snapshot.line(point.file, point.side, point.line) !== point.anchor) {
			throw new Error(`Invalid diff-tour point ${index + 1}: path, side, line or anchor is not in the comparison.`);
		}
	}
	return points;
}

export function saveDiffTour(root: string, artifact: DiffTourArtifact): string {
	const dir = path.join(root, '.vantage');
	fs.mkdirSync(dir, { recursive: true });
	const destination = path.join(dir, 'diff-tour.json');
	const temp = path.join(dir, `.diff-tour-${process.pid}-${Date.now()}.tmp`);
	try {
		fs.writeFileSync(temp, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
		fs.renameSync(temp, destination);
	} finally {
		if (fs.existsSync(temp)) { fs.unlinkSync(temp); }
	}
	return destination;
}
