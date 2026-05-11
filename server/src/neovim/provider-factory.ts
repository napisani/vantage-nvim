import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
import type { BackendProvider } from './provider';

export interface ProviderEnvironment {
	[key: string]: string | undefined;
	LEARN_PROVIDER?: string;
	LEARN_CODEX_COMMAND?: string;
	LEARN_CODEX_MODEL?: string;
	LEARN_CODEX_TIMEOUT_MS?: string;
}

export function createProviderFromEnv(env: ProviderEnvironment): BackendProvider {
	const providerName = env.LEARN_PROVIDER ?? 'fake';

	if (providerName === 'fake') {
		return new FakeProvider();
	}

	if (providerName === 'codex') {
		return new CodexProvider({
			command: env.LEARN_CODEX_COMMAND,
			model: env.LEARN_CODEX_MODEL,
			timeoutMs: parseOptionalPositiveInteger(env.LEARN_CODEX_TIMEOUT_MS, 'LEARN_CODEX_TIMEOUT_MS'),
		});
	}

	throw new Error(`Unsupported provider "${providerName}". Expected "fake" or "codex".`);
}

function parseOptionalPositiveInteger(value: string | undefined, label: string): number | undefined {
	if (value === undefined || value.trim() === '') {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}

	return parsed;
}
