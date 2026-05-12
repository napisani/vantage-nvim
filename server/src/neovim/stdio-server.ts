import * as readline from 'node:readline';
import { handleBackendRequest } from './handlers';
import { parseBackendRequest } from './protocol';
import type { BackendResponse } from './protocol';

const writeResponse = (response: BackendResponse): void => {
	process.stdout.write(`${JSON.stringify(response)}\n`);
};

const interfaceReader = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});

const inFlight = new Map<string, AbortController>();

function tryHandleCancel(raw: unknown): boolean {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return false;
	}

	const record = raw as { method?: unknown; params?: unknown };
	if (record.method !== 'cancelRequest') {
		return false;
	}

	const params = record.params;
	if (typeof params !== 'object' || params === null || Array.isArray(params)) {
		return true;
	}

	const requestId = (params as { id?: unknown }).id;
	if (typeof requestId !== 'string') {
		return true;
	}

	inFlight.get(requestId)?.abort();
	return true;
}

interfaceReader.on('line', (line) => {
	void (async () => {
		if (line.trim().length === 0) {
			return;
		}

		let requestId = 'unknown';
		try {
			const raw = JSON.parse(line) as unknown;
			if (tryHandleCancel(raw)) {
				return;
			}
			const request = parseBackendRequest(raw);
			requestId = request.id;
			const controller = new AbortController();
			inFlight.set(request.id, controller);
			try {
				writeResponse(await handleBackendRequest(request, undefined, { signal: controller.signal }));
			} finally {
				inFlight.delete(request.id);
			}
		} catch (error) {
			writeResponse({
				id: requestId,
				ok: false,
				error: {
					code: 'bad_request',
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	})();
});
