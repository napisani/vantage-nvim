import * as readline from 'node:readline';
import { Effect } from 'effect';
import { handleBackendRequestEffect } from './handlers';
import { parseBackendRequest } from './protocol';
import { BadRequestError, errorMessage, JsonParseError } from './effect-errors';
import type { AgentRuntimeProgress, BackendRequest, BackendResponse } from './protocol';

const writeResponse = (response: BackendResponse): void => {
	process.stdout.write(`${JSON.stringify(response)}\n`);
};

const writeProgress = (id: string, progress: AgentRuntimeProgress): void => {
	process.stdout.write(`${JSON.stringify({ id, type: 'progress', progress })}\n`);
};

const interfaceReader = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});

const inFlight = new Map<string, AbortController>();

type UnknownRecord = Record<string, unknown>;

function tryHandleCancel(raw: unknown): boolean {
	if (!isUnknownRecord(raw)) {
		return false;
	}

	if (raw.method !== 'cancelRequest') {
		return false;
	}

	if (!isUnknownRecord(raw.params)) {
		return true;
	}

	const requestId = raw.params.id;
	if (typeof requestId !== 'string') {
		return true;
	}

	inFlight.get(requestId)?.abort();
	return true;
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interfaceReader.on('line', (line) => {
	void Effect.runPromise(handleLineEffect(line));
});

function handleLineEffect(line: string): Effect.Effect<void> {
	let requestId = 'unknown';

	return Effect.gen(function* () {
		if (line.trim().length === 0) {
			return;
		}

		const raw = yield* parseJsonLineEffect(line);
		if (tryHandleCancel(raw)) {
			return;
		}

		const request = yield* parseRequestEffect(raw);
		requestId = request.id;
		const controller = new AbortController();
		yield* Effect.sync(() => {
			inFlight.set(request.id, controller);
		});
		const response = yield* handleBackendRequestEffect(request, undefined, {
			signal: controller.signal,
			reportProgress: (progress) => {
				writeProgress(request.id, progress);
			},
		}).pipe(
			Effect.ensuring(Effect.sync(() => {
				inFlight.delete(request.id);
			}))
		);
		yield* writeResponseEffect(response);
	}).pipe(
		Effect.catchAll((error) => writeResponseEffect(badRequestResponse(requestId, error))),
		Effect.catchAllDefect((defect) => writeResponseEffect(badRequestResponse(requestId, defect)))
	);
}

function parseJsonLineEffect(line: string): Effect.Effect<unknown, JsonParseError> {
	return Effect.try({
		try: () => {
			const parsed: unknown = JSON.parse(line);
			return parsed;
		},
		catch: (cause) => new JsonParseError({
			message: errorMessage(cause),
			cause,
		}),
	});
}

function parseRequestEffect(raw: unknown): Effect.Effect<BackendRequest, BadRequestError> {
	return Effect.try({
		try: () => parseBackendRequest(raw),
		catch: (cause) => new BadRequestError({
			message: errorMessage(cause),
			cause,
		}),
	});
}

function writeResponseEffect(response: BackendResponse): Effect.Effect<void> {
	return Effect.sync(() => {
		writeResponse(response);
	});
}

function badRequestResponse(id: string, error: unknown): BackendResponse {
	return {
		id,
		ok: false,
		error: {
			code: 'bad_request',
			message: errorMessage(error),
		},
	};
}
