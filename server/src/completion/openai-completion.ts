/**
 * OpenAI completion module.
 *
 * This intentionally produces teaching-oriented explanations (not code solutions).
 */

import OpenAI from 'openai';
import type { Position } from 'vscode-languageserver/node';
import type { SearchResult } from '../embeddings';

export interface CompletionConfig {
	apiKey?: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
}

export interface CompletionRequest {
	fileName: string;
	cursorPosition: Position;
	codeSnippet: string;
	contexts: SearchResult[];
}

export class OpenAICompletionClient {
	private client: OpenAI;
	private model: string;
	private maxTokens: number;
	private temperature: number;

	constructor(config: CompletionConfig = {}) {
		const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error('Missing OPENAI_API_KEY');
		}

		this.client = new OpenAI({ apiKey });
		this.model = config.model ?? process.env.LEARN_LS_COMPLETION_MODEL ?? 'gpt-4o-mini';
		this.maxTokens = config.maxTokens ?? Number(process.env.LEARN_LS_COMPLETION_MAX_TOKENS ?? '256');
		this.temperature = config.temperature ?? Number(process.env.LEARN_LS_COMPLETION_TEMPERATURE ?? '0.7');
	}

	private buildPrompt(req: CompletionRequest): string {
		// Based on the original prompt from server.ts (pre-RAG).
		// We now add retrieved contexts to ground the explanation.
		const contextsText = req.contexts
			.map((ctx, idx) => {
				return [
					`[Context ${idx + 1}]`,
					`Source: ${ctx.source}`,
					ctx.text.trim(),
				].join('\n');
			})
			.join('\n\n');

		return `You are an expert programming assistant. A developer is working on this file and is currently learning the elixir programming language.
Do not provide solutions. Your goal is to TEACH the developer by providing documentation excerpts, explanations and guidance in small digestible pieces that
are most relevant to the current cursor position. Do not provide suggestions for modifications. Only provide educational information that helps the developer understand the code better,
especially relevant nix concepts. For example, if the cursor is on a nix derivation, briefly explain derivation concept in nix, how it works, and syntax of how it can be defined.

Use the following retrieved contexts as source material. If the contexts are not sufficient or not relevant, say what is missing.
Prefer short quotes and explain them. When referencing a context, mention its Source.
Include code examples that would be helpful or relevant for learning the fundamentals being worked with.

Be concise and to the point. Use bullet points or numbered lists where appropriate to break down complex concepts.

Use markdown formatting for code snippets and explanations.

limit your response to around 300 words.

File: ${req.fileName}
Cursor Position: Line ${req.cursorPosition.line + 1}, Character ${req.cursorPosition.character + 1}

Code Snippet:
${req.codeSnippet}

Retrieved Contexts:
${contextsText}

Answer:`;
	}

	async complete(req: CompletionRequest): Promise<string> {
		const prompt = this.buildPrompt(req);

		const completion = await this.client.chat.completions.create({
			model: this.model,
			messages: [
				{
					role: 'user',
					content: prompt,
				},
			],
			max_tokens: this.maxTokens,
			temperature: this.temperature,
		});

		return completion.choices[0]?.message?.content ?? 'No response from ChatGPT';
	}
}
