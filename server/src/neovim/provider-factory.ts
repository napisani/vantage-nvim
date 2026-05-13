import { ChatGptProvider } from './chatgpt-provider';
import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
import { OllamaProvider } from './ollama-provider';
import type { BackendProvider } from './provider';

export interface ProviderEnvironment {
	[key: string]: string | undefined;
	VANTAGE_PROVIDER?: string;
	VANTAGE_CODEX_COMMAND?: string;
	VANTAGE_CODEX_MODEL?: string;
	VANTAGE_CODEX_TIMEOUT_MS?: string;
	VANTAGE_CODEX_ANNOTATION_TIMEOUT_MS?: string;
	VANTAGE_CODEX_TRACE_PROMPT_PATH?: string;
	VANTAGE_CODEX_TRACE_RESPONSE_PATH?: string;
	VANTAGE_OLLAMA_BASE_URL?: string;
	VANTAGE_OLLAMA_MODEL?: string;
	VANTAGE_OLLAMA_TIMEOUT_MS?: string;
	VANTAGE_OLLAMA_ANNOTATION_TIMEOUT_MS?: string;
	VANTAGE_OLLAMA_TRACE_PROMPT_PATH?: string;
	VANTAGE_OLLAMA_TRACE_RESPONSE_PATH?: string;
	OPENAI_API_KEY?: string;
	VANTAGE_CHATGPT_API_KEY?: string;
	VANTAGE_CHATGPT_MODEL?: string;
	VANTAGE_CHATGPT_TIMEOUT_MS?: string;
	VANTAGE_CHATGPT_ANNOTATION_TIMEOUT_MS?: string;
	VANTAGE_CHATGPT_TRACE_PROMPT_PATH?: string;
	VANTAGE_CHATGPT_TRACE_RESPONSE_PATH?: string;
}

export function createProviderFromEnv(env: ProviderEnvironment): BackendProvider {
	const providerName = env.VANTAGE_PROVIDER ?? 'fake';

	if (providerName === 'fake') {
		return new FakeProvider();
	}

	if (providerName === 'codex') {
		return new CodexProvider({
			command: env.VANTAGE_CODEX_COMMAND,
			model: env.VANTAGE_CODEX_MODEL,
			timeoutMs: parseOptionalPositiveInteger(env.VANTAGE_CODEX_TIMEOUT_MS, 'VANTAGE_CODEX_TIMEOUT_MS'),
			annotationTimeoutMs: parseOptionalPositiveInteger(
				env.VANTAGE_CODEX_ANNOTATION_TIMEOUT_MS,
				'VANTAGE_CODEX_ANNOTATION_TIMEOUT_MS'
			),
			tracePromptPath: env.VANTAGE_CODEX_TRACE_PROMPT_PATH,
			traceResponsePath: env.VANTAGE_CODEX_TRACE_RESPONSE_PATH,
		});
	}

	if (providerName === 'ollama') {
		return new OllamaProvider({
			baseUrl: env.VANTAGE_OLLAMA_BASE_URL,
			model: env.VANTAGE_OLLAMA_MODEL,
			timeoutMs: parseOptionalPositiveInteger(env.VANTAGE_OLLAMA_TIMEOUT_MS, 'VANTAGE_OLLAMA_TIMEOUT_MS'),
			annotationTimeoutMs: parseOptionalPositiveInteger(
				env.VANTAGE_OLLAMA_ANNOTATION_TIMEOUT_MS,
				'VANTAGE_OLLAMA_ANNOTATION_TIMEOUT_MS'
			),
			tracePromptPath: env.VANTAGE_OLLAMA_TRACE_PROMPT_PATH,
			traceResponsePath: env.VANTAGE_OLLAMA_TRACE_RESPONSE_PATH,
		});
	}

	if (providerName === 'chatgpt') {
		return new ChatGptProvider({
			env,
			model: env.VANTAGE_CHATGPT_MODEL,
			timeoutMs: parseOptionalPositiveInteger(env.VANTAGE_CHATGPT_TIMEOUT_MS, 'VANTAGE_CHATGPT_TIMEOUT_MS'),
			annotationTimeoutMs: parseOptionalPositiveInteger(
				env.VANTAGE_CHATGPT_ANNOTATION_TIMEOUT_MS,
				'VANTAGE_CHATGPT_ANNOTATION_TIMEOUT_MS'
			),
			tracePromptPath: env.VANTAGE_CHATGPT_TRACE_PROMPT_PATH,
			traceResponsePath: env.VANTAGE_CHATGPT_TRACE_RESPONSE_PATH,
		});
	}

	throw new Error(`Unsupported provider "${providerName}". Expected "fake", "codex", "ollama", or "chatgpt".`);
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
