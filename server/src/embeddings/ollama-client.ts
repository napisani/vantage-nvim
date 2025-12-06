/**
 * Ollama client for generating embeddings using embeddinggemma:300m model
 */

import { Ollama } from 'ollama';

export class OllamaEmbeddingClient {
	private client: Ollama;
	private model: string;

	constructor(host: string = 'http://localhost:11434', model: string = 'embeddinggemma:300m') {
		this.client = new Ollama({ host });
		this.model = model;
	}

	/**
	 * Generate embeddings for a single text
	 * @param text - Text to generate embeddings for
	 * @returns Embedding vector
	 */
	async generateEmbedding(text: string): Promise<number[]> {
		try {
			const response = await this.client.embeddings({
				model: this.model,
				prompt: text,
			});

			return response.embedding;
		} catch (error) {
			throw new Error(`Failed to generate embedding: ${error}`);
		}
	}

	/**
	 * Generate embeddings for multiple texts in batch
	 * @param texts - Array of texts to generate embeddings for
	 * @returns Array of embedding vectors
	 */
	async generateEmbeddings(texts: string[]): Promise<number[][]> {
		const embeddings: number[][] = [];

		for (const text of texts) {
			const embedding = await this.generateEmbedding(text);
			embeddings.push(embedding);
		}

		return embeddings;
	}

	/**
	 * Check if the model is available
	 */
	async checkModelAvailability(): Promise<boolean> {
		try {
			const models = await this.client.list();
			return models.models.some(m => m.name.includes(this.model));
		} catch (error) {
			console.error('Failed to check model availability:', error);
			return false;
		}
	}
}
