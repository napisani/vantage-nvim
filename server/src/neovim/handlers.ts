import { BackendRequest, BackendResponse } from './protocol';
import { createProviderFromEnv } from './provider-factory';
import type { BackendProvider, ProviderRequestContext } from './provider';

const defaultProvider = createProviderFromEnv(process.env);

export async function handleBackendRequest(
	request: BackendRequest,
	provider: BackendProvider = defaultProvider,
	context: ProviderRequestContext = {}
): Promise<BackendResponse> {
	try {
		switch (request.method) {
			case 'explainSelection':
				return { id: request.id, ok: true, result: await provider.explainSelection(request.params, context) };
			case 'annotateRange':
				return { id: request.id, ok: true, result: await provider.annotateRange(request.params, context) };
			case 'reviewCurrentHunk':
				return { id: request.id, ok: true, result: await provider.reviewCurrentHunk(request.params, context) };
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
