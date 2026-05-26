import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { Context } from '@earendil-works/pi-ai';
import type {
	AgentCacheRetention,
	AgentContext,
	AgentSessionConfig,
	BaseRequestParams,
	LensMode,
} from './protocol';
import { buildAgentContextUpdatePrompt } from './model-contract';

export type AgentSessionMessage = Context['messages'][number];

export interface ModelTarget {
	provider: string;
	model: string;
}

export interface SessionScope {
	workspaceRoot: string;
	provider: string;
	model: string;
	lensMode: LensMode;
}

interface SessionTurn {
	user: AgentSessionMessage;
	assistant: AgentSessionMessage;
}

export interface SessionState {
	scope: SessionScope;
	sessionId: string;
	createdAt: number;
	updatedAt: number;
	latestContextRevision?: string;
	latestContextTurn?: AgentSessionMessage;
	turns: SessionTurn[];
}

export interface AgentSessionInvocation {
	session: SessionState;
	context: Context;
	options: {
		sessionId: string;
		cacheRetention: AgentCacheRetention;
	};
}

const DEFAULT_SESSION_CONFIG: Required<AgentSessionConfig> = {
	enabled: true,
	max_turns: 12,
	cacheRetention: 'short',
};

export class AgentSessionStore {
	private readonly sessions = new Map<string, SessionState>();

	get(scope: SessionScope): SessionState {
		const key = scopeKey(scope);
		const existing = this.sessions.get(key);
		if (existing) {
			return existing;
		}

		const now = Date.now();
		const session: SessionState = {
			scope,
			sessionId: `vantage-${hashText(key).slice(0, 24)}`,
			createdAt: now,
			updatedAt: now,
			turns: [],
		};
		this.sessions.set(key, session);
		return session;
	}

	status(scope: SessionScope): SessionState | undefined {
		return this.sessions.get(scopeKey(scope));
	}

	reset(scope: SessionScope): boolean {
		return this.sessions.delete(scopeKey(scope));
	}
}

export class VantageAgentSessions {
	readonly config: Required<AgentSessionConfig>;
	private readonly store: AgentSessionStore;

	constructor(config: AgentSessionConfig | undefined, store: AgentSessionStore) {
		this.config = { ...DEFAULT_SESSION_CONFIG, ...(config ?? {}) };
		this.store = store;
	}

	get enabled(): boolean {
		return this.config.enabled;
	}

	createInvocation(params: BaseRequestParams, target: ModelTarget, userMessage: AgentSessionMessage): AgentSessionInvocation {
		const session = this.store.get(this.scope(params, target));
		const context = this.contextFor(session, params.agentContext, userMessage);
		return {
			session,
			context,
			options: {
				sessionId: session.sessionId,
				cacheRetention: this.config.cacheRetention,
			},
		};
	}

	recordSuccessfulTurn(
		session: SessionState,
		userMessage: AgentSessionMessage,
		assistantMessage: AgentSessionMessage
	): void {
		session.turns.push({
			user: userMessage,
			assistant: assistantMessage,
		});
		while (session.turns.length > this.config.max_turns) {
			session.turns.shift();
		}
		session.updatedAt = Date.now();
	}

	reset(params: BaseRequestParams, target: ModelTarget): string {
		if (!this.enabled) {
			return '## Vantage Agent Session\n\nAgent sessions are disabled.';
		}

		const scope = this.scope(params, target);
		const removed = this.store.reset(scope);
		return [
			'## Vantage Agent Session',
			'',
			removed ? 'Session reset.' : 'No active session existed for this scope.',
			'',
			`Workspace: \`${scope.workspaceRoot}\``,
			`Model target: \`${scope.provider}/${scope.model}\``,
			`Lens mode: \`${scope.lensMode}\``,
		].join('\n');
	}

	status(params: BaseRequestParams, target: ModelTarget): string {
		if (!this.enabled) {
			return '## Vantage Agent Session\n\nAgent sessions are disabled.';
		}

		const scope = this.scope(params, target);
		return renderSessionStatus(scope, this.store.status(scope));
	}

	private scope(params: BaseRequestParams, target: ModelTarget): SessionScope {
		return {
			workspaceRoot: params.workspaceRoot ?? workspaceFromFilePath(params.filePath),
			provider: target.provider,
			model: target.model,
			lensMode: params.lens?.mode ?? 'general',
		};
	}

	private contextFor(
		session: SessionState,
		agentContext: AgentContext | undefined,
		userMessage: AgentSessionMessage
	): Context {
		const contextRevision = agentContext ? agentContextRevision(agentContext) : undefined;
		if (agentContext && contextRevision !== session.latestContextRevision) {
			session.latestContextRevision = contextRevision;
			session.latestContextTurn = userMessageFor(buildAgentContextUpdatePrompt({
				...agentContext,
				revision: contextRevision,
			}));
			session.updatedAt = Date.now();
		}

		const messages: Context['messages'] = [];
		if (session.latestContextTurn) {
			messages.push(session.latestContextTurn);
		}
		for (const turn of session.turns) {
			messages.push(turn.user, turn.assistant);
		}
		messages.push(userMessage);
		return { messages };
	}
}

export function userMessageFor(content: string): AgentSessionMessage {
	return {
		role: 'user',
		content,
		timestamp: Date.now(),
	};
}

export function sessionPromptParams<T extends BaseRequestParams>(params: T, sessionEnabled: boolean): T {
	if (!sessionEnabled || !params.agentContext) {
		return params;
	}

	return {
		...params,
		agentContext: undefined,
	};
}

function renderSessionStatus(scope: SessionScope, session: SessionState | undefined): string {
	const lines = [
		'## Vantage Agent Session',
		'',
		`Workspace: \`${scope.workspaceRoot}\``,
		`Model target: \`${scope.provider}/${scope.model}\``,
		`Lens mode: \`${scope.lensMode}\``,
		`Turn count: ${session?.turns.length ?? 0}`,
	];

	if (session) {
		lines.push(`Session id: \`${session.sessionId}\``);
		lines.push(`Latest context revision: \`${session.latestContextRevision ?? 'none'}\``);
		lines.push(`Created: ${new Date(session.createdAt).toISOString()}`);
		lines.push(`Updated: ${new Date(session.updatedAt).toISOString()}`);
	} else {
		lines.push('No active session exists for this scope.');
	}

	return lines.join('\n');
}

function scopeKey(scope: SessionScope): string {
	return JSON.stringify(scope);
}

function hashText(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

function agentContextRevision(agentContext: AgentContext): string {
	return agentContext.revision ?? hashText([
		agentContext.path,
		agentContext.modifiedAt ?? '',
		agentContext.truncated ? 'truncated' : 'full',
		agentContext.content,
	].join('\0'));
}

function workspaceFromFilePath(filePath: string): string {
	if (filePath.trim().length === 0) {
		return 'unknown-workspace';
	}
	return path.dirname(filePath);
}
