import {
	CodeLens,
	createConnection,
	DidChangeTextDocumentParams,
	DidCloseTextDocumentParams,
	DidOpenTextDocumentParams,
	ExecuteCommandParams,
	InitializeResult,
	Position,
	TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';

import { EmbeddingManager } from './embeddings';
import type { SearchResult } from './embeddings';
import { OpenAICompletionClient } from './completion/openai-completion';

const connection = createConnection();

const logStream = createWriteStream('/tmp/learn-ls.log', { flags: 'a' });
const log = (message: string) => {
	const line = `[${new Date().toISOString()}] ${message}\n`;
	logStream.write(line);
	connection.console.log(message);
};

const documents = new Map<string, TextDocument>();

const RAG_CODELENS_COMMAND = 'learnls.showRagContext';

const getFileNameFromUri = (uri: string): string => {
	try {
		const parsed = new URL(uri);
		return parsed.pathname.split('/').pop() ?? uri;
	} catch {
		return uri.split('/').pop() ?? uri;
	}
};

// Prefer an explicit env var; otherwise resolve relative to server/out at runtime.
const defaultDbPath = path.resolve(__dirname, '../data/embeddings.db');
const embeddingsDbPath = process.env.LEARN_LS_EMBEDDINGS_DB_PATH ?? defaultDbPath;

const maxLines = Number(process.env.LEARN_LS_CODELENS_MAX_LINES ?? '100000');
const contextRadius = Number(process.env.LEARN_LS_CONTEXT_RADIUS ?? '6');
const contextTopK = Number(process.env.LEARN_LS_CONTEXT_TOPK ?? '3');
const cacheMaxEntries = Number(process.env.LEARN_LS_CACHE_MAX ?? '5000');

let embeddingManager: EmbeddingManager | null = null;
let completionClient: OpenAICompletionClient | null = null;

type LensData = {
	uri: string;
	line: number;
	version: number;
};

type ExecuteArgs = {
	uri?: string;
	line?: number;
	selectionText?: string;
	format?: 'markdown' | 'text';
	showInMessage?: boolean;
};

type CommandResponse = {
	format: 'markdown' | 'text';
	content: string;
};

type CachedLineResult = {
	uri: string;
	line: number;
	version: number;
	queryText: string;
	contexts: SearchResult[];
	answerText: string | null;
	answerMarkdown: string | null;
};

const lineCache = new Map<string, CachedLineResult>();
const getCacheKey = (uri: string, version: number, line: number) => `${uri}::${version}::${line}`;

const pruneCacheIfNeeded = () => {
	if (lineCache.size <= cacheMaxEntries) {
		return;
	}

	const overflow = lineCache.size - cacheMaxEntries;
	const keys = lineCache.keys();
	for (let i = 0; i < overflow; i++) {
		const next = keys.next();
		if (next.done) {
			break;
		}
		lineCache.delete(next.value);
	}
};

const getDocumentLines = (document: TextDocument): string[] => {
	return document.getText().split(/\r?\n/);
};

const clampSnippet = (snippet: string): string => {
	const trimmed = snippet.trim();
	if (trimmed.length > 4000) {
		return trimmed.slice(0, 4000);
	}
	return trimmed;
};

const getQuerySnippetForLine = (document: TextDocument, line: number): string => {
	const lines = getDocumentLines(document);
	if (lines.length === 0) {
		return '';
	}

	const startLine = Math.max(0, line - contextRadius);
	const endLine = Math.min(lines.length - 1, line + contextRadius);
	return clampSnippet(lines.slice(startLine, endLine + 1).join('\n'));
};

const formatPreview = (text: string, maxLen = 80): string => {
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (normalized.length <= maxLen) {
		return normalized;
	}
	return `${normalized.slice(0, maxLen - 1)}…`;
};

const formatLensTitle = (result: SearchResult): string => {
	const preview = formatPreview(result.text, 70);
	return `Learn: ${result.source} — ${preview}`;
};

const escapeCodeFence = (text: string): string => {
	// Avoid accidentally closing fenced blocks.
	return text.replace(/```/g, '``\u200b`');
};

const buildAnswerMarkdown = (answer: string, contexts: SearchResult[]): string => {
	const sources = contexts
		.map((c) => `- ${c.source} (distance: ${c.distance.toFixed(4)})`)
		.join('\n');

	return [
		'## Learn-ls',
		'',
		answer.trim(),
		'',
		'---',
		'### Retrieved Sources',
		sources || '- (none)',
	].join('\n');
};

log('Starting learn-ls language server (RAG + completion via CodeLens)');

connection.onDidOpenTextDocument((event: DidOpenTextDocumentParams) => {
	const { textDocument } = event;
	const doc = TextDocument.create(
		textDocument.uri,
		textDocument.languageId ?? '',
		textDocument.version ?? 0,
		textDocument.text ?? ''
	);
	documents.set(textDocument.uri, doc);
	log(`Document opened: ${textDocument.uri}`);

	connection.sendRequest('workspace/codeLens/refresh').catch(() => {
		// ignore
	});
});

connection.onDidCloseTextDocument((event: DidCloseTextDocumentParams) => {
	documents.delete(event.textDocument.uri);
	log(`Document closed: ${event.textDocument.uri}`);
});

connection.onDidChangeTextDocument((event: DidChangeTextDocumentParams) => {
	const { textDocument, contentChanges } = event;
	const current = documents.get(textDocument.uri);
	if (!current) {
		log(`Change received for unknown document ${textDocument.uri}`);
		return;
	}

	const updated = TextDocument.update(
		current,
		contentChanges,
		textDocument.version ?? current.version
	);
	documents.set(textDocument.uri, updated);

	// Clear cached results for this document.
	for (const key of lineCache.keys()) {
		if (key.startsWith(`${textDocument.uri}::`)) {
			lineCache.delete(key);
		}
	}

	connection.sendRequest('workspace/codeLens/refresh').catch(() => {
		// ignore
	});
});

connection.onInitialize(async (params) => {
	log(
		`Initialize request (rootUri=${params.rootUri ?? 'unknown'}, locale=${params.locale ?? 'unknown'})`
	);

	try {
		embeddingManager = new EmbeddingManager({
			ollamaHost: process.env.LEARN_LS_OLLAMA_HOST ?? 'http://localhost:11434',
			embeddingModel: process.env.LEARN_LS_EMBEDDING_MODEL ?? 'embeddinggemma:300m',
			dbPath: embeddingsDbPath,
			embeddingDims: Number(process.env.LEARN_LS_EMBEDDING_DIMS ?? '256'),
		});
		const stats = embeddingManager.getStats();
		log(
			`EmbeddingManager ready (db=${embeddingsDbPath}, docs=${stats.documentCount}, dims=${stats.embeddingDims}, model=${stats.model})`
		);
	} catch (error) {
		embeddingManager = null;
		log(`Failed to initialize EmbeddingManager: ${error instanceof Error ? error.message : String(error)}`);
	}

	try {
		completionClient = new OpenAICompletionClient();
		log('OpenAICompletionClient ready');
	} catch (error) {
		completionClient = null;
		log(`OpenAICompletionClient unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			codeLensProvider: {
				resolveProvider: true,
			},
			executeCommandProvider: {
				commands: [RAG_CODELENS_COMMAND],
			},
		},
		serverInfo: {
			name: 'learn-ls',
			version: '0.4.0',
		},
	};

	return result;
});

connection.onCodeLens(async (params): Promise<CodeLens[]> => {
	const uri = params?.textDocument?.uri;
	if (!uri) {
		log('CodeLens request missing textDocument.uri');
		return [];
	}

	const doc = documents.get(uri);
	if (!doc) {
		log(`CodeLens request for unknown document: ${uri}`);
		return [];
	}

	const lines = getDocumentLines(doc);
	if (lines.length === 0) {
		return [];
	}

	const capped = Math.min(lines.length, maxLines);
	const lenses: CodeLens[] = [];

	for (let line = 0; line < capped; line++) {
		if (!lines[line] || lines[line].trim().length === 0) {
			continue;
		}

		const data: LensData = {
			uri,
			line,
			version: doc.version,
		};

		lenses.push({
			range: {
				start: { line, character: 0 },
				end: { line, character: 0 },
			},
			data,
		});
	}

	return lenses;
});

connection.onCodeLensResolve(async (lens: CodeLens): Promise<CodeLens> => {
	const data = lens.data as LensData | undefined;
	if (!data || typeof data.uri !== 'string' || typeof data.line !== 'number' || typeof data.version !== 'number') {
		lens.command = {
			title: 'Learn',
			command: RAG_CODELENS_COMMAND,
			arguments: [{ showInMessage: false, format: 'markdown' } satisfies ExecuteArgs],
		};
		return lens;
	}

	const doc = documents.get(data.uri);
	const effectiveVersion = doc?.version ?? data.version;
	const cacheKey = getCacheKey(data.uri, effectiveVersion, data.line);
	const cached = lineCache.get(cacheKey);

	let title = 'Learn';
	if (cached?.contexts?.length) {
		title = formatLensTitle(cached.contexts[0]);
	} else if (cached && cached.answerMarkdown === null && cached.answerText === null) {
		title = 'Learn: no relevant context';
	}

	lens.command = {
		title,
		command: RAG_CODELENS_COMMAND,
		arguments: [
			{
				uri: data.uri,
				line: data.line,
				format: 'markdown',
				showInMessage: false,
			} satisfies ExecuteArgs,
		],
	};

	return lens;
});

connection.onExecuteCommand(async (params: ExecuteCommandParams): Promise<CommandResponse> => {
	if (params.command !== RAG_CODELENS_COMMAND) {
		return { format: 'text', content: 'Unsupported command.' };
	}

	const rawArg = Array.isArray(params.arguments) ? params.arguments[0] : undefined;
	const args = (rawArg && typeof rawArg === 'object' ? (rawArg as ExecuteArgs) : {}) satisfies ExecuteArgs;

	const showInMessage = args.showInMessage ?? true;
	const format: CommandResponse['format'] = args.format === 'markdown' ? 'markdown' : 'text';

	const respond = (msg: string): CommandResponse => {
		if (showInMessage) {
			connection.window.showInformationMessage(msg);
		}
		return { format: 'text', content: msg };
	};

	if (!embeddingManager) {
		return respond('Embeddings unavailable.');
	}

	if (!completionClient) {
		return respond('OpenAI completion unavailable (missing OPENAI_API_KEY?).');
	}

	let uri = args.uri;
	let line = args.line;
	let queryText: string | null = null;
	let cursorPosition: Position = { line: 0, character: 0 };
	let fileName = uri ? getFileNameFromUri(uri) : 'unknown';

	// Selection mode: use selectionText as the full query.
	if (typeof args.selectionText === 'string' && args.selectionText.trim().length > 0) {
		queryText = clampSnippet(args.selectionText);
		if (typeof uri === 'string') {
			fileName = getFileNameFromUri(uri);
		}
		if (typeof line === 'number') {
			cursorPosition = { line, character: 0 };
		}
	} else {
		// Line mode: use snippet around the current line.
		if (typeof uri !== 'string' || typeof line !== 'number') {
			return respond('No line context available.');
		}

		const doc = documents.get(uri);
		if (!doc) {
			return respond('Document not available on server.');
		}

		fileName = getFileNameFromUri(uri);
		cursorPosition = { line, character: 0 };
		queryText = getQuerySnippetForLine(doc, line);

		// If cached for this line+version, return cached answer.
		const cacheKey = getCacheKey(uri, doc.version, line);
		const cached = lineCache.get(cacheKey);
		if (cached?.answerMarkdown || cached?.answerText) {
			const cachedContent = format === 'markdown' ? (cached.answerMarkdown ?? cached.answerText ?? '') : (cached.answerText ?? cached.answerMarkdown ?? '');
			return { format, content: cachedContent };
		}
	}

	if (!queryText || queryText.trim().length === 0) {
		return respond('No text available to search.');
	}

	// Step 1: retrieve contexts
	let contexts: SearchResult[] = [];
	try {
		contexts = await embeddingManager.search(queryText, contextTopK);
	} catch (error) {
		return respond(`Embedding search failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (contexts.length === 0) {
		return respond('No relevant context found in the embeddings database.');
	}

	// Step 2: generate final teaching answer using completion model
	let answer: string;
	try {
		answer = await completionClient.complete({
			fileName,
			cursorPosition,
			codeSnippet: escapeCodeFence(queryText),
			contexts,
		});
	} catch (error) {
		return respond(`Completion failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	const markdown = buildAnswerMarkdown(answer, contexts);
	const content = format === 'markdown' ? markdown : answer;

	// Cache line results so CodeLens titles can update.
	if (typeof uri === 'string' && typeof line === 'number') {
		const doc = documents.get(uri);
		if (doc) {
			const cacheKey = getCacheKey(uri, doc.version, line);
			lineCache.set(cacheKey, {
				uri,
				line,
				version: doc.version,
				queryText,
				contexts,
				answerText: answer,
				answerMarkdown: markdown,
			});
			pruneCacheIfNeeded();

			connection.sendRequest('workspace/codeLens/refresh').catch(() => {
				// ignore
			});
		}
	}

	if (showInMessage) {
		connection.window.showInformationMessage('Learn-ls answer ready (returned to client).');
	}

	return { format, content };
});

connection.onShutdown(() => {
	log('Shutting down language server');
	try {
		embeddingManager?.close();
	} catch {
		// ignore
	}
	logStream.end();
});

connection.onExit(() => {
	log('Language server exited');
});

connection.listen();
