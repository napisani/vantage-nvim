import { z } from 'zod';

export const RequestSchema = z.object({
	version: z.literal(1),
	method: z.enum(['probe', 'snapshot']),
	workspaceRoot: z.string(),
});
export type BridgeRequest = z.infer<typeof RequestSchema>;

export const SnapshotSchema = z.object({
	sessionId: z.string().min(1),
	leafId: z.string().nullable(),
	workspaceRoot: z.string(),
	provider: z.string().min(1),
	model: z.string().min(1),
	thinkingLevel: z.string(),
	// Native Pi JSONL, not a lossy transcript or a path into a live session file.
	branch: z.string(),
	entryCount: z.number().int().nonnegative(),
	parentBusy: z.boolean().optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const ResponseSchema = z.discriminatedUnion('kind', [
	z.object({ version: z.literal(1), kind: z.literal('ready') }),
	z.object({ version: z.literal(1), kind: z.literal('snapshot'), snapshot: SnapshotSchema }),
	z.object({ version: z.literal(1), kind: z.literal('error'), message: z.string() }),
]);
export type BridgeResponse = z.infer<typeof ResponseSchema>;
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
// A snapshot is serialized on the parent Pi's event loop, which a busy turn can
// block well past the time a bare probe needs.
export const PROBE_TIMEOUT_MS = 5000;
export const SNAPSHOT_TIMEOUT_MS = 30000;
