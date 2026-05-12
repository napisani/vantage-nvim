import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
import { OllamaProvider } from './ollama-provider';
import type { BackendProvider } from './provider';

export interface ProviderEnvironment {
	[key: string]: string | undefined;
	LEARN_PROVIDER?: string;
	LEARN_CODEX_COMMAND?: string;
	LEARN_CODEX_MODEL?: string;
	LEARN_CODEX_TIMEOUT_MS?: string;
	LEARN_CODEX_ANNOTATION_TIMEOUT_MS?: string;
	LEARN_CODEX_TRACE_PROMPT_PATH?: string;
	LEARN_CODEX_TRACE_RESPONSE_PATH?: string;
	LEARN_OLLAMA_BASE_URL?: string;
	LEARN_OLLAMA_MODEL?: string;
	LEARN_OLLAMA_TIMEOUT_MS?: string;
	LEARN_OLLAMA_ANNOTATION_TIMEOUT_MS?: string;
	LEARN_OLLAMA_TRACE_PROMPT_PATH?: string;
	LEARN_OLLAMA_TRACE_RESPONSE_PATH?: string;
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
			annotationTimeoutMs: parseOptionalPositiveInteger(
				env.LEARN_CODEX_ANNOTATION_TIMEOUT_MS,
				'LEARN_CODEX_ANNOTATION_TIMEOUT_MS'
			),
			tracePromptPath: env.LEARN_CODEX_TRACE_PROMPT_PATH,
			traceResponsePath: env.LEARN_CODEX_TRACE_RESPONSE_PATH,
		});
	}

	if (providerName === 'ollama') {
		return new OllamaProvider({
			baseUrl: env.LEARN_OLLAMA_BASE_URL,
			model: env.LEARN_OLLAMA_MODEL,
			timeoutMs: parseOptionalPositiveInteger(env.LEARN_OLLAMA_TIMEOUT_MS, 'LEARN_OLLAMA_TIMEOUT_MS'),
			annotationTimeoutMs: parseOptionalPositiveInteger(
				env.LEARN_OLLAMA_ANNOTATION_TIMEOUT_MS,
				'LEARN_OLLAMA_ANNOTATION_TIMEOUT_MS'
			),
			tracePromptPath: env.LEARN_OLLAMA_TRACE_PROMPT_PATH,
			traceResponsePath: env.LEARN_OLLAMA_TRACE_RESPONSE_PATH,
		});
	}

	throw new Error(`Unsupported provider "${providerName}". Expected "fake", "codex", or "ollama".`);
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
