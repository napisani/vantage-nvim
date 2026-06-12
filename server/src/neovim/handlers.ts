import { Effect } from 'effect';
import type { BackendRequest, BackendResponse, BackendResult } from './protocol';
import { createAgentRuntimeFromConfig } from './agent-runtime-factory';
import type { AgentRuntime, AgentRuntimeRequestContext } from './agent-runtime';
import { runBackendCommand } from './backend-command';
import {
	BackendCommandExecutionError,
	BackendRuntimeConfigurationError,
	errorMessage,
} from './effect-errors';

export function handleBackendRequestEffect(
	request: BackendRequest,
	agentRuntime: AgentRuntime | undefined = undefined,
	context: AgentRuntimeRequestContext = {}
): Effect.Effect<BackendResponse> {
	return Effect.gen(function* () {
		yield* reportProgressEffect(context, {
			stage: 'backend_received',
			message: `Backend received ${request.method}.`,
			details: { method: request.method },
		});
		const activeRuntime = yield* createRuntimeEffect(request, agentRuntime);
		yield* reportProgressEffect(context, {
			stage: 'runtime_ready',
			message: 'Agent runtime is ready.',
			details: runtimeDetails(request),
		});
		const result = yield* runCommandEffect(activeRuntime, request, context);
		return { id: request.id, ok: true, result } satisfies BackendResponse;
	}).pipe(
		Effect.catchAll((error) => Effect.succeed(handlerErrorResponse(request.id, error))),
		Effect.catchAllDefect((defect) => Effect.succeed(handlerErrorResponse(request.id, defect)))
	);
}

export async function handleBackendRequest(
	request: BackendRequest,
	agentRuntime: AgentRuntime | undefined = undefined,
	context: AgentRuntimeRequestContext = {}
): Promise<BackendResponse> {
	return Effect.runPromise(handleBackendRequestEffect(request, agentRuntime, context));
}

function createRuntimeEffect(
	request: BackendRequest,
	agentRuntime: AgentRuntime | undefined
): Effect.Effect<AgentRuntime, BackendRuntimeConfigurationError> {
	return Effect.try({
		try: () => agentRuntime ?? createAgentRuntimeFromConfig(request.config),
		catch: (cause) => new BackendRuntimeConfigurationError({
			message: errorMessage(cause),
			cause,
		}),
	});
}

function runCommandEffect(
	runtime: AgentRuntime,
	request: BackendRequest,
	context: AgentRuntimeRequestContext
): Effect.Effect<BackendResult, BackendCommandExecutionError> {
	return Effect.tryPromise({
		try: () => Promise.resolve(runBackendCommand(runtime, request, context)),
		catch: (cause) => new BackendCommandExecutionError({
			method: request.method,
			message: errorMessage(cause),
			cause,
		}),
	});
}

function reportProgressEffect(
	context: AgentRuntimeRequestContext,
	progress: Parameters<NonNullable<AgentRuntimeRequestContext['reportProgress']>>[0]
): Effect.Effect<void> {
	return Effect.sync(() => {
		context.reportProgress?.(progress);
	});
}

function handlerErrorResponse(id: string, error: unknown): BackendResponse {
	return {
		id,
		ok: false,
		error: {
			code: 'handler_error',
			message: errorMessage(error),
		},
	};
}

function runtimeDetails(request: BackendRequest): Record<string, unknown> {
	const agent = request.config?.agent ?? {};
	return {
		runtime: agent.runtime ?? 'pi',
		provider: agent.provider,
		model: agent.model,
	};
}
