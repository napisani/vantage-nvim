/**
 * RAG (Retrieval-Augmented Generation) module
 * Combines semantic search with LLM completion using Ollama
 */

import { Ollama } from 'ollama';
import { EmbeddingManager } from './embedding-manager.js';
import type { RAGConfig, RAGResult, SearchResult } from './types.js';

export class RAGModule {
	private embeddingManager: EmbeddingManager;
	private ollamaClient: Ollama;
	private completionModel: string;
	private topK: number;
	private temperature: number;
	private systemPrompt: string;

	constructor(embeddingManager: EmbeddingManager, config?: RAGConfig) {
		this.embeddingManager = embeddingManager;
		
		const ollamaHost = config?.ollamaHost || 'http://localhost:11434';
		this.ollamaClient = new Ollama({ host: ollamaHost });
		this.completionModel = config?.completionModel || 'gemma2:2b';
		this.topK = config?.topK || 3;
		this.temperature = config?.temperature || 0.7;
		this.systemPrompt = config?.systemPrompt || 
			`Use the following contexts to answer the question comprehensively.
If you don't know the answer based on the provided contexts, just say that you don't know.`;
	}

	/**
	 * Perform RAG query: semantic search + LLM completion
	 * @param question - User's question
	 * @param topK - Number of documents to retrieve (optional, uses config default)
	 * @returns RAG result with answer and contexts
	 */
	async query(question: string, topK?: number): Promise<RAGResult> {
		const k = topK || this.topK;

		// Step 1: Semantic search to retrieve relevant contexts
		const contexts = await this.embeddingManager.search(question, k);

		if (contexts.length === 0) {
			return {
				question,
				answer: "No relevant information found in the knowledge base.",
				contexts: [],
				model: this.completionModel
			};
		}

		// Step 2: Build prompt with retrieved contexts
		const combinedContext = contexts.map((ctx, idx) => 
			`[Context ${idx + 1}]\nSource: ${ctx.source}\n${ctx.text}`
		).join('\n\n');

		const prompt = `${this.systemPrompt}

Contexts:
${combinedContext}

Question: ${question}

Answer:`;

		// Step 3: Generate response with local LLM
		try {
			const response = await this.ollamaClient.chat({
				model: this.completionModel,
				messages: [
					{
						role: 'user',
						content: prompt
					}
				],
				options: {
					temperature: this.temperature
				}
			});

			return {
				question,
				answer: response.message.content,
				contexts,
				model: this.completionModel,
				tokensUsed: response.eval_count || undefined
			};
		} catch (error) {
			throw new Error(`Failed to generate completion: ${error}`);
		}
	}

	/**
	 * Perform RAG query with streaming response
	 * @param question - User's question
	 * @param topK - Number of documents to retrieve (optional)
	 * @param onChunk - Callback for each streaming chunk
	 * @returns RAG result with full answer and contexts
	 */
	async queryStream(
		question: string, 
		onChunk: (chunk: string) => void,
		topK?: number
	): Promise<RAGResult> {
		const k = topK || this.topK;

		// Step 1: Semantic search
		const contexts = await this.embeddingManager.search(question, k);

		if (contexts.length === 0) {
			const answer = "No relevant information found in the knowledge base.";
			onChunk(answer);
			return {
				question,
				answer,
				contexts: [],
				model: this.completionModel
			};
		}

		// Step 2: Build prompt
		const combinedContext = contexts.map((ctx, idx) => 
			`[Context ${idx + 1}]\nSource: ${ctx.source}\n${ctx.text}`
		).join('\n\n');

		const prompt = `${this.systemPrompt}

Contexts:
${combinedContext}

Question: ${question}

Answer:`;

		// Step 3: Stream response
		try {
			const stream = await this.ollamaClient.chat({
				model: this.completionModel,
				messages: [
					{
						role: 'user',
						content: prompt
					}
				],
				options: {
					temperature: this.temperature
				},
				stream: true
			});

			let fullAnswer = '';
			for await (const chunk of stream) {
				const content = chunk.message?.content || '';
				fullAnswer += content;
				onChunk(content);
			}

			return {
				question,
				answer: fullAnswer,
				contexts,
				model: this.completionModel
			};
		} catch (error) {
			throw new Error(`Failed to stream completion: ${error}`);
		}
	}

	/**
	 * Get only the relevant contexts without LLM generation
	 * Useful for debugging or custom prompt building
	 */
	async getContexts(question: string, topK?: number): Promise<SearchResult[]> {
		const k = topK || this.topK;
		return this.embeddingManager.search(question, k);
	}

	/**
	 * Update RAG configuration
	 */
	updateConfig(config: Partial<RAGConfig>): void {
		if (config.completionModel !== undefined) {
			this.completionModel = config.completionModel;
		}
		if (config.topK !== undefined) {
			this.topK = config.topK;
		}
		if (config.temperature !== undefined) {
			this.temperature = config.temperature;
		}
		if (config.systemPrompt !== undefined) {
			this.systemPrompt = config.systemPrompt;
		}
	}

	/**
	 * Check if the completion model is available in Ollama
	 */
	async checkModelAvailability(): Promise<boolean> {
		try {
			const models = await this.ollamaClient.list();
			return models.models.some(m => m.name.includes(this.completionModel));
		} catch (error) {
			console.error('Failed to check model availability:', error);
			return false;
		}
	}
}
