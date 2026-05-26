import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import type { BackendMethod, BackendRequest, BackendResult } from './protocol';

export const BACKEND_METHODS = [
	'explainSelection',
	'questionSelection',
	'editSelection',
	'annotateRange',
	'reviewCurrentHunk',
	'agentSessionReset',
	'agentSessionStatus',
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
		case 'reviewCurrentHunk':
			return runtime.reviewCurrentHunk(request.params, context);
		case 'agentSessionReset':
			return runtime.agentSessionReset(request.params, context);
		case 'agentSessionStatus':
			return runtime.agentSessionStatus(request.params, context);
	}
}
