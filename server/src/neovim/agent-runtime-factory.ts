import { DevelopmentAgentRuntime } from './development-agent-runtime';
import { CodingAgentRuntime, CodingAgentSessionStore } from './coding-agent-runtime';
import type { BackendRequestConfig } from './protocol';
import type { AgentRuntime } from './agent-runtime';

const sessionStore = new CodingAgentSessionStore();

export function createAgentRuntimeFromConfig(config: BackendRequestConfig = {}): AgentRuntime {
	const agent = config.agent ?? {};

	if (agent.runtime === 'development') {
		return new DevelopmentAgentRuntime();
	}

	return new CodingAgentRuntime({
		provider: agent.provider,
		model: agent.model,
		auth: agent.auth,
		options: agent.options,
		sessionOutput: agent.session_output,
		commandOptions: {
			explain: config.commands?.explain,
			question: config.commands?.question,
			edit: config.commands?.edit,
			annotate: config.commands?.annotate,
			search: config.commands?.search,
		},
		store: sessionStore,
	});
}
