import { BackendRequest, BackendResponse } from './protocol';
import { FakeProvider } from './fake-provider';

const provider = new FakeProvider();

export async function handleBackendRequest(request: BackendRequest): Promise<BackendResponse> {
	try {
		switch (request.method) {
			case 'explainSelection':
				return { id: request.id, ok: true, result: provider.explainSelection(request.params) };
			case 'annotateRange':
				return { id: request.id, ok: true, result: provider.annotateRange(request.params) };
			case 'reviewCurrentHunk':
				return { id: request.id, ok: true, result: provider.reviewCurrentHunk(request.params) };
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
