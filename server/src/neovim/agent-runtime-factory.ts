import { DevelopmentAgentRuntime } from './development-agent-runtime';
import { AgentSessionStore } from './agent-session';
import { PiAgentRuntime } from './pi-agent-runtime';
import type { BackendRequestConfig } from './protocol';
import type { AgentRuntime } from './agent-runtime';

const sessionStore = new AgentSessionStore();

export function createAgentRuntimeFromConfig(config: BackendRequestConfig = {}): AgentRuntime {
	const agent = config.agent ?? {};

	if (agent.runtime === 'development') {
		return new DevelopmentAgentRuntime();
	}

	return new PiAgentRuntime({
		provider: agent.provider,
		model: agent.model,
		auth: agent.auth,
		options: agent.options,
		session: agent.session,
		commandOptions: {
			explain: config.commands?.explain?.options,
			question: config.commands?.question?.options,
			edit: config.commands?.edit?.options,
			annotate: config.commands?.annotate?.options,
			review: config.commands?.review?.options,
		},
		tracePromptPath: agent.trace?.prompt_path,
		traceResponsePath: agent.trace?.response_path,
		sessionStore,
	});
}
