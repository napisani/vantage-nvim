import { ChatGptProvider } from './chatgpt-provider';
import { CodexProvider } from './codex-provider';
import { FakeProvider } from './fake-provider';
import { OllamaProvider } from './ollama-provider';
import { PiProvider } from './pi-provider';
import type { BackendProviderConfig } from './protocol';
import type { BackendProvider } from './provider';

export interface ProviderEnvironment {
	[key: string]: string | undefined;
	OPENAI_API_KEY?: string;
	ANTHROPIC_API_KEY?: string;
}

export function createProviderFromConfig(
	config: BackendProviderConfig = {},
	env: ProviderEnvironment = process.env
): BackendProvider {
	const providerName = config.name ?? 'fake';

	if (providerName === 'fake') {
		return new FakeProvider();
	}

	if (providerName === 'codex') {
		const codex = config.codex ?? {};
		return new CodexProvider({
			command: codex.command,
			model: codex.model,
			timeoutMs: codex.timeout_ms,
			annotationTimeoutMs: codex.annotation_timeout_ms,
			tracePromptPath: codex.trace_prompt_path,
			traceResponsePath: codex.trace_response_path,
		});
	}

	if (providerName === 'ollama') {
		const ollama = config.ollama ?? {};
		return new OllamaProvider({
			baseUrl: ollama.base_url,
			model: ollama.model,
			timeoutMs: ollama.timeout_ms,
			annotationTimeoutMs: ollama.annotation_timeout_ms,
			tracePromptPath: ollama.trace_prompt_path,
			traceResponsePath: ollama.trace_response_path,
		});
	}

	if (providerName === 'chatgpt') {
		const chatgpt = config.chatgpt ?? {};
		return new ChatGptProvider({
			env,
			apiKey: chatgpt.api_key,
			model: chatgpt.model,
			timeoutMs: chatgpt.timeout_ms,
			annotationTimeoutMs: chatgpt.annotation_timeout_ms,
			tracePromptPath: chatgpt.trace_prompt_path,
			traceResponsePath: chatgpt.trace_response_path,
		});
	}

	if (providerName === 'pi') {
		const pi = config.pi ?? {};
		return new PiProvider({
			env,
			provider: pi.provider,
			model: pi.model,
			apiKey: pi.api_key,
			timeoutMs: pi.timeout_ms,
			annotationTimeoutMs: pi.annotation_timeout_ms,
			tracePromptPath: pi.trace_prompt_path,
			traceResponsePath: pi.trace_response_path,
		});
	}

	throw new Error(`Unsupported provider "${String(providerName)}". Expected "fake", "codex", "ollama", "chatgpt", or "pi".`);
}
