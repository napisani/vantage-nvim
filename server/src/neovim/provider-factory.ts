import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
import type { BackendProvider } from './provider';

export interface ProviderEnvironment {
	[key: string]: string | undefined;
	LEARN_PROVIDER?: string;
	LEARN_CODEX_COMMAND?: string;
	LEARN_CODEX_MODEL?: string;
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
		});
	}

	throw new Error(`Unsupported provider "${providerName}". Expected "fake" or "codex".`);
}
