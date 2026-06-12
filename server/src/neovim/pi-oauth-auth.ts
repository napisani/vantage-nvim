import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentAuthConfig, AgentRuntimeProgress } from './protocol';

interface OAuthCredentials {
	refresh: string;
	access: string;
	expires: number;
	[key: string]: unknown;
}

type OAuthCredentialsMap = Record<string, OAuthCredentials>;

interface PiOAuthModule {
	getOAuthProvider(provider: string): unknown | undefined;
	getOAuthApiKey(
		provider: string,
		credentials: OAuthCredentialsMap
	): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null>;
}

export interface PiOAuthCredentialRequest {
	provider: string;
	auth?: AgentAuthConfig;
	workspaceRoot?: string;
	reportProgress?: (progress: AgentRuntimeProgress) => void;
}

export interface PiCredentialResolver {
	resolveApiKey(request: PiOAuthCredentialRequest): Promise<string | undefined>;
}

export interface PiOAuthCredentialResolverOptions {
	cwd?: () => string;
	homeDir?: () => string;
	importOAuth?: () => Promise<PiOAuthModule>;
}

interface AuthPathCandidate {
	path: string;
	explicit: boolean;
}

const AUTH_FILE = 'auth.json';

export class PiOAuthCredentialResolver implements PiCredentialResolver {
	private readonly cwd: () => string;
	private readonly homeDir: () => string;
	private readonly importOAuth: () => Promise<PiOAuthModule>;

	constructor(options: PiOAuthCredentialResolverOptions = {}) {
		this.cwd = options.cwd ?? (() => process.cwd());
		this.homeDir = options.homeDir ?? (() => os.homedir());
		this.importOAuth = options.importOAuth ?? importPiOAuth;
	}

	async resolveApiKey(request: PiOAuthCredentialRequest): Promise<string | undefined> {
		const oauth = await this.importOAuth();
		if (!oauth.getOAuthProvider(request.provider)) {
			reportProgress(request, {
				stage: 'oauth_provider_skipped',
				message: 'Provider does not use Pi OAuth credentials.',
				details: { provider: request.provider },
			});
			return undefined;
		}

		for (const candidate of this.authPathCandidates(request)) {
			const credentials = await this.readCredentials(candidate, request);
			if (!credentials) {
				continue;
			}

			const result = await oauth.getOAuthApiKey(request.provider, credentials);
			if (!result) {
				continue;
			}

			credentials[request.provider] = {
				type: 'oauth',
				...result.newCredentials,
			};
			await this.writeCredentials(candidate.path, credentials);
			return result.apiKey;
		}

		return undefined;
	}

	private authPathCandidates(request: PiOAuthCredentialRequest): AuthPathCandidate[] {
		const configuredPath = request.auth?.path?.trim();
		if (configuredPath) {
			return [
				{
					path: this.resolveAuthPath(configuredPath, request.workspaceRoot),
					explicit: true,
				},
			];
		}

		const paths: AuthPathCandidate[] = [];
		const seen = new Set<string>();
		const add = (authPath: string): void => {
			const resolved = path.resolve(authPath);
			if (seen.has(resolved)) {
				return;
			}
			seen.add(resolved);
			paths.push({ path: resolved, explicit: false });
		};

		if (request.workspaceRoot) {
			add(path.join(request.workspaceRoot, AUTH_FILE));
		}
		add(path.join(this.cwd(), AUTH_FILE));
		add(path.join(this.homeDir(), '.config', 'pi', AUTH_FILE));
		add(path.join(this.homeDir(), '.config', 'pi-ai', AUTH_FILE));
		return paths;
	}

	private resolveAuthPath(authPath: string, workspaceRoot: string | undefined): string {
		const expanded = expandHomePath(authPath, this.homeDir());
		if (path.isAbsolute(expanded)) {
			return path.resolve(expanded);
		}

		return path.resolve(workspaceRoot ?? this.cwd(), expanded);
	}

	private async readCredentials(
		candidate: AuthPathCandidate,
		request: PiOAuthCredentialRequest
	): Promise<OAuthCredentialsMap | undefined> {
		reportProgress(
			request,
			{
				stage: 'oauth_auth_file_check',
				message: 'Checking Pi OAuth auth file.',
				details: { path: candidate.path, explicit: candidate.explicit },
			}
		);
		let content: string;
		try {
			content = await fs.readFile(candidate.path, 'utf8');
		} catch (error) {
			if (isNotFoundError(error)) {
				if (candidate.explicit) {
					throw new Error(
						`Pi OAuth auth file not found at ${candidate.path}. Run npx @earendil-works/pi-ai login ${request.provider} or update agent.auth.path.`
					);
				}
				reportProgress(
					request,
					{
						stage: 'oauth_auth_file_missing',
						message: 'Pi OAuth auth file was not found.',
						details: { path: candidate.path, explicit: candidate.explicit },
					}
				);
				return undefined;
			}

			throw new Error(`Failed to read Pi OAuth auth file at ${candidate.path}: ${errorMessage(error)}`);
		}

		try {
			const parsed = JSON.parse(content) as unknown;
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				throw new Error('expected a JSON object');
			}
			reportProgress(
				request,
				{
					stage: 'oauth_auth_file_loaded',
					message: 'Loaded Pi OAuth auth file.',
					details: { path: candidate.path, explicit: candidate.explicit },
				}
			);
			return parsed as OAuthCredentialsMap;
		} catch (error) {
			throw new Error(`Failed to parse Pi OAuth auth file at ${candidate.path}: ${errorMessage(error)}`);
		}
	}

	private async writeCredentials(authPath: string, credentials: OAuthCredentialsMap): Promise<void> {
		await fs.mkdir(path.dirname(authPath), { recursive: true });
		await fs.writeFile(authPath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
	}
}

function reportProgress(request: Pick<PiOAuthCredentialRequest, 'reportProgress'>, progress: AgentRuntimeProgress): void {
	request.reportProgress?.(progress);
}

async function importPiOAuth(): Promise<PiOAuthModule> {
	const dynamicImport = new Function('specifier', 'return import(specifier)') as (
		specifier: string
	) => Promise<PiOAuthModule>;
	return dynamicImport('@earendil-works/pi-ai/oauth');
}

function expandHomePath(authPath: string, homeDir: string): string {
	if (authPath === '~') {
		return homeDir;
	}
	if (authPath.startsWith('~/')) {
		return path.join(homeDir, authPath.slice(2));
	}
	return authPath;
}

function isNotFoundError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
