import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import type { BackendMethod, BackendRequest, BackendResult } from './protocol';

export const BACKEND_METHODS = [
	'explainSelection',
	'questionSelection',
	'editSelection',
	'annotateRange',
	'searchLocations',
	'agentCancel',
	'agentSessionReset',
	'agentSessionStatus',
	'agentSessionOutput',
	'listSkills',
] as const;

export function isBackendMethod(value: unknown): value is BackendMethod {
	return typeof value === 'string' && (BACKEND_METHODS as readonly string[]).includes(value);
}

export function runBackendCommand(
	runtime: AgentRuntime,
	request: BackendRequest,
	context: AgentRuntimeRequestContext
): Promise<BackendResult> | BackendResult {
	switch (request.method) {
		case 'explainSelection':
			return runtime.explainSelection(request.params, context);
		case 'questionSelection':
			return runtime.questionSelection(request.params, context);
		case 'editSelection':
			return runtime.editSelection(request.params, context);
		case 'annotateRange':
			return runtime.annotateRange(request.params, context);
		case 'searchLocations':
			return runtime.searchLocations(request.params, context);
		case 'agentCancel':
			return runtime.agentCancel(request.params, context);
		case 'agentSessionReset':
			return runtime.agentSessionReset(request.params, context);
		case 'agentSessionStatus':
			return runtime.agentSessionStatus(request.params, context);
		case 'agentSessionOutput':
			return runtime.agentSessionOutput(request.params, context);
		case 'listSkills':
			return runtime.listSkills(request.params, context);
	}
}
