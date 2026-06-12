import type { AgentSession } from '@earendil-works/pi-coding-agent';

interface SessionRecord {
	workspaceRoot: string;
	provider: string;
	model: string;
	session: AgentSession;
}

interface ActiveRequest {
	kind: string;
	abort: () => Promise<void> | void;
	outputEntryId?: string;
}

type SessionOutputStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface SessionOutputEvent {
	time: number;
	type: string;
	summary: string;
	details?: unknown;
}

interface SessionOutputEntry {
	id: string;
	kind: string;
	transient: boolean;
	status: SessionOutputStatus;
	startedAt: number;
	endedAt?: number;
	provider: string;
	model: string;
	userSummary: string;
	prompt: string;
	assistantText?: string;
	events: SessionOutputEvent[];
	error?: string;
}

export class CodingAgentSessionStore {
	private record?: SessionRecord;
	private active?: ActiveRequest;
	private outputHistory: SessionOutputEntry[] = [];
	private outputSequence = 0;
	private historyLimit = 10;

	setHistoryLimit(limit: number | undefined): void {
		if (Number.isInteger(limit) && Number(limit) > 0) {
			this.historyLimit = Number(limit);
		}
		this.trimHistory();
	}

	isActive(): boolean {
		return this.active !== undefined;
	}

	activeKind(): string | undefined {
		return this.active?.kind;
	}

	begin(kind: string, abort: () => Promise<void> | void, outputEntryId?: string): void {
		if (this.active) {
			throw new Error(`Vantage agent is already running ${this.active.kind}. Use :VantageAgentCancel first.`);
		}
		this.active = { kind, abort, outputEntryId };
	}

	end(): void {
		this.active = undefined;
	}

	async cancel(): Promise<boolean> {
		const active = this.active;
		if (!active) {
			return false;
		}
		this.finishOutputEntry(active.outputEntryId, 'cancelled');
		await active.abort();
		this.active = undefined;
		return true;
	}

	async reset(): Promise<boolean> {
		if (this.active) {
			throw new Error('Vantage agent is busy. Use :VantageAgentCancel before reset.');
		}
		const hadState = this.record !== undefined || this.outputHistory.length > 0;
		if (this.record) {
			this.record.session.dispose();
			this.record = undefined;
		}
		this.outputHistory = [];
		return hadState;
	}

	status(): { active?: string; session?: SessionRecord; outputHistoryCount: number } {
		return {
			active: this.active?.kind,
			session: this.record,
			outputHistoryCount: this.outputHistory.length,
		};
	}

	startOutputEntry(input: {
		kind: string;
		transient: boolean;
		provider: string;
		model: string;
		userSummary: string;
		prompt: string;
	}): string {
		const id = `session-output-${++this.outputSequence}`;
		this.outputHistory.push({
			id,
			kind: input.kind,
			transient: input.transient,
			status: 'running',
			startedAt: Date.now(),
			provider: input.provider,
			model: input.model,
			userSummary: input.userSummary,
			prompt: input.prompt,
			events: [],
		});
		this.trimHistory();
		return id;
	}

	appendOutputEvent(entryId: string | undefined, event: Omit<SessionOutputEvent, 'time'>): void {
		const entry = this.findOutputEntry(entryId);
		if (!entry) {
			return;
		}
		entry.events.push({ time: Date.now(), ...event });
	}

	setAssistantText(entryId: string | undefined, assistantText: string): void {
		const entry = this.findOutputEntry(entryId);
		if (entry) {
			entry.assistantText = assistantText;
		}
	}

	finishOutputEntry(entryId: string | undefined, status: SessionOutputStatus, error?: string): void {
		const entry = this.findOutputEntry(entryId);
		if (!entry || entry.status === 'cancelled') {
			return;
		}
		entry.status = status;
		entry.endedAt = Date.now();
		if (error) {
			entry.error = error;
		}
	}

	renderOutput(raw: boolean | undefined): string {
		return renderSessionOutput(this.outputHistory, raw === true);
	}

	private findOutputEntry(entryId: string | undefined): SessionOutputEntry | undefined {
		return entryId ? this.outputHistory.find((entry) => entry.id === entryId) : undefined;
	}

	private trimHistory(): void {
		while (this.outputHistory.length > this.historyLimit) {
			this.outputHistory.shift();
		}
	}

	async getOrCreate(options: {
		workspaceRoot: string;
		provider: string;
		model: string;
		createSession: () => Promise<AgentSession>;
	}): Promise<AgentSession> {
		if (this.record && this.record.workspaceRoot === options.workspaceRoot) {
			return this.record.session;
		}

		if (this.record) {
			this.record.session.dispose();
			this.record = undefined;
		}

		const session = await options.createSession();
		this.record = {
			workspaceRoot: options.workspaceRoot,
			provider: options.provider,
			model: options.model,
			session,
		};
		return session;
	}
}

function renderSessionOutput(entries: SessionOutputEntry[], raw: boolean): string {
	const lines = ['## Vantage Session Output', ''];
	if (entries.length === 0) {
		lines.push('No Vantage session activity recorded yet.');
		return lines.join('\n');
	}

	for (const entry of entries) {
		const transient = entry.transient ? ' · transient' : '';
		lines.push(`### ${entry.kind}${transient} · ${entry.status} · ${entry.provider}/${entry.model} · ${formatTime(entry.startedAt)}`);
		lines.push('');
		lines.push(`- Started: ${new Date(entry.startedAt).toISOString()}`);
		if (entry.endedAt) {
			lines.push(`- Ended: ${new Date(entry.endedAt).toISOString()}`);
		}
		lines.push(`- Request: ${entry.userSummary}`);
		if (entry.error) {
			lines.push(`- Error: ${entry.error}`);
		}
		const events = raw ? entry.events : curatedEvents(entry.events);
		if (events.length > 0) {
			lines.push('', '#### Tool and agent activity');
			for (const event of events) {
				lines.push(`- ${formatTime(event.time)} ${event.summary}`);
			}
		}
		if (entry.assistantText?.trim()) {
			lines.push('', '#### Assistant', '', entry.assistantText.trim());
		}
		if (raw) {
			lines.push('', '#### Raw prompt', '', '```text', entry.prompt, '```');
			lines.push('', '#### Raw events', '', '```json');
			lines.push(JSON.stringify(entry.events, null, 2));
			lines.push('```');
		}
		lines.push('');
	}
	return lines.join('\n').trimEnd();
}

function curatedEvents(events: SessionOutputEvent[]): SessionOutputEvent[] {
	let messageUpdates = 0;
	let lastMessageUpdateTime = Date.now();
	const curated: SessionOutputEvent[] = [];
	for (const event of events) {
		if (event.type === 'message_update') {
			messageUpdates += 1;
			lastMessageUpdateTime = event.time;
			continue;
		}
		if (event.summary === 'message completed' || event.type === 'message_start') {
			continue;
		}
		curated.push(event);
	}
	if (messageUpdates > 0) {
		curated.push({
			time: lastMessageUpdateTime,
			type: 'message_updates',
			summary: `assistant streamed ${messageUpdates} update(s)`,
		});
	}
	return curated.sort((left, right) => left.time - right.time);
}

function formatTime(value: number): string {
	return new Date(value).toISOString().slice(11, 19);
}
