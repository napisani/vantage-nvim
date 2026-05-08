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

interfaceReader.on('line', (line) => {
	void (async () => {
		if (line.trim().length === 0) {
			return;
		}

		let requestId = 'unknown';
		try {
			const raw = JSON.parse(line) as unknown;
			const request = parseBackendRequest(raw);
			requestId = request.id;
			writeResponse(await handleBackendRequest(request));
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
