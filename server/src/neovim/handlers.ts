import { BackendRequest, BackendResponse } from './protocol';
import { createAgentRuntimeFromConfig } from './agent-runtime-factory';
import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import { runBackendCommand } from './backend-command';

export async function handleBackendRequest(
	request: BackendRequest,
	agentRuntime: AgentRuntime | undefined = undefined,
	context: AgentRuntimeRequestContext = {}
): Promise<BackendResponse> {
	try {
		context.reportProgress?.({
			stage: 'backend_received',
			message: `Backend received ${request.method}.`,
			details: { method: request.method },
		});
		const activeRuntime = agentRuntime ?? createAgentRuntimeFromConfig(request.config);
		context.reportProgress?.({
			stage: 'runtime_ready',
			message: 'Agent runtime is ready.',
			details: runtimeDetails(request),
		});
		return { id: request.id, ok: true, result: await runBackendCommand(activeRuntime, request, context) };
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

function runtimeDetails(request: BackendRequest): Record<string, unknown> {
	const agent = request.config?.agent ?? {};
	return {
		runtime: agent.runtime ?? 'pi',
		provider: agent.provider,
		model: agent.model,
	};
}
