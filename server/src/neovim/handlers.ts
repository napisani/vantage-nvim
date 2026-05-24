import { BackendRequest, BackendResponse } from './protocol';
import { createAgentRuntimeFromConfig } from './agent-runtime-factory';
import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';

export async function handleBackendRequest(
	request: BackendRequest,
	agentRuntime: AgentRuntime | undefined = undefined,
	context: AgentRuntimeRequestContext = {}
): Promise<BackendResponse> {
	try {
		const activeRuntime = agentRuntime ?? createAgentRuntimeFromConfig(request.config);
		switch (request.method) {
			case 'explainSelection':
				return { id: request.id, ok: true, result: await activeRuntime.explainSelection(request.params, context) };
			case 'annotateRange':
				return { id: request.id, ok: true, result: await activeRuntime.annotateRange(request.params, context) };
			case 'reviewCurrentHunk':
				return { id: request.id, ok: true, result: await activeRuntime.reviewCurrentHunk(request.params, context) };
			case 'agentSessionReset':
				return { id: request.id, ok: true, result: await activeRuntime.agentSessionReset(request.params, context) };
			case 'agentSessionStatus':
				return { id: request.id, ok: true, result: await activeRuntime.agentSessionStatus(request.params, context) };
		}
	} catch (error) {
		return {
			id: request.id,
			ok: false,
			error: {
				code: 'handler_error',
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}
