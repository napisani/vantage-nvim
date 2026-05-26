import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PiOAuthCredentialResolver } from './pi-oauth-auth';

test('PiOAuthCredentialResolver reads workspace auth.json and persists refreshed credentials', async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-workspace-'));
	const authPath = path.join(workspace, 'auth.json');
	await fs.writeFile(authPath, JSON.stringify({
		'openai-codex': {
			type: 'oauth',
			refresh: 'refresh-one',
			access: 'access-one',
			expires: Date.now() + 60_000,
		},
	}), 'utf8');

	const resolver = new PiOAuthCredentialResolver({
		importOAuth: async () => ({
			getOAuthProvider: (provider: string) => provider === 'openai-codex' ? { id: provider } : undefined,
			getOAuthApiKey: async () => ({
				apiKey: 'resolved-oauth-token',
				newCredentials: {
					refresh: 'refresh-two',
					access: 'access-two',
					expires: Date.now() + 120_000,
				},
			}),
		}),
	});

	try {
		const apiKey = await resolver.resolveApiKey({
			provider: 'openai-codex',
			workspaceRoot: workspace,
		});
		const saved = JSON.parse(await fs.readFile(authPath, 'utf8')) as Record<string, Record<string, unknown>>;

		assert.equal(apiKey, 'resolved-oauth-token');
		assert.equal(saved['openai-codex'].type, 'oauth');
		assert.equal(saved['openai-codex'].access, 'access-two');
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});

test('PiOAuthCredentialResolver reads the Pi CLI auth file from ~/.config/pi/auth.json by default', async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-home-workspace-'));
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-home-cwd-'));
	const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-home-'));
	const authPath = path.join(home, '.config', 'pi', 'auth.json');
	await fs.mkdir(path.dirname(authPath), { recursive: true });
	await fs.writeFile(authPath, JSON.stringify({
		'openai-codex': {
			type: 'oauth',
			refresh: 'refresh-home',
			access: 'access-home',
			expires: Date.now() + 60_000,
		},
	}), 'utf8');
	const resolver = new PiOAuthCredentialResolver({
		cwd: () => cwd,
		homeDir: () => home,
		importOAuth: async () => ({
			getOAuthProvider: (provider: string) => provider === 'openai-codex' ? { id: provider } : undefined,
			getOAuthApiKey: async (_provider, credentials) => credentials['openai-codex']
				? {
						apiKey: 'resolved-home-token',
						newCredentials: {
							refresh: 'refresh-home-two',
							access: 'access-home-two',
							expires: Date.now() + 120_000,
						},
					}
				: null,
		}),
	});

	try {
		const apiKey = await resolver.resolveApiKey({
			provider: 'openai-codex',
			workspaceRoot: workspace,
		});
		const saved = JSON.parse(await fs.readFile(authPath, 'utf8')) as Record<string, Record<string, unknown>>;

		assert.equal(apiKey, 'resolved-home-token');
		assert.equal(saved['openai-codex'].access, 'access-home-two');
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
		await fs.rm(cwd, { recursive: true, force: true });
		await fs.rm(home, { recursive: true, force: true });
	}
});

test('PiOAuthCredentialResolver returns undefined when no default auth file exists', async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-missing-workspace-'));
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-missing-cwd-'));
	const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-missing-home-'));
	const resolver = new PiOAuthCredentialResolver({
		cwd: () => cwd,
		homeDir: () => home,
		importOAuth: async () => ({
			getOAuthProvider: (provider: string) => provider === 'openai-codex' ? { id: provider } : undefined,
			getOAuthApiKey: async () => null,
		}),
	});

	try {
		const apiKey = await resolver.resolveApiKey({
			provider: 'openai-codex',
			workspaceRoot: workspace,
		});

		assert.equal(apiKey, undefined);
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
		await fs.rm(cwd, { recursive: true, force: true });
		await fs.rm(home, { recursive: true, force: true });
	}
});

test('PiOAuthCredentialResolver ignores auth files for non-OAuth providers', async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-non-oauth-'));
	await fs.writeFile(path.join(workspace, 'auth.json'), '{not valid json', 'utf8');
	const resolver = new PiOAuthCredentialResolver({
		importOAuth: async () => ({
			getOAuthProvider: () => undefined,
			getOAuthApiKey: async () => {
				throw new Error('OAuth API key lookup should not run for non-OAuth providers');
			},
		}),
	});

	try {
		const apiKey = await resolver.resolveApiKey({
			provider: 'openai',
			workspaceRoot: workspace,
		});

		assert.equal(apiKey, undefined);
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});

test('PiOAuthCredentialResolver reports an explicit missing auth path', async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-oauth-explicit-missing-'));
	const resolver = new PiOAuthCredentialResolver();

	try {
		await assert.rejects(
			() =>
				resolver.resolveApiKey({
					provider: 'openai-codex',
					auth: {
						path: path.join(workspace, 'missing-auth.json'),
					},
					workspaceRoot: workspace,
				}),
			/Pi OAuth auth file not found/
		);
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});
