import { BackendRequest, BackendResponse } from './protocol';
import { createProviderFromConfig } from './provider-factory';
import type { BackendProvider, ProviderRequestContext } from './provider';

export async function handleBackendRequest(
	request: BackendRequest,
	provider: BackendProvider | undefined = undefined,
	context: ProviderRequestContext = {}
): Promise<BackendResponse> {
	try {
		const activeProvider = provider ?? createProviderFromConfig(request.config?.provider, process.env);
		switch (request.method) {
			case 'explainSelection':
				return { id: request.id, ok: true, result: await activeProvider.explainSelection(request.params, context) };
			case 'annotateRange':
				return { id: request.id, ok: true, result: await activeProvider.annotateRange(request.params, context) };
			case 'reviewCurrentHunk':
				return { id: request.id, ok: true, result: await activeProvider.reviewCurrentHunk(request.params, context) };
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
