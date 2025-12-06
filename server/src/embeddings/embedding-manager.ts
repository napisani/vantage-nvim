/**
 * Main EmbeddingManager class for processing directories of text files
 * and storing them in a vector database for retrieval
 */

import * as fs from 'fs';
import * as path from 'path';
import { OllamaEmbeddingClient } from './ollama-client';
import { VectorStore } from './vector-store';
import type { EmbeddingConfig, DocumentChunk, EmbeddingStats } from './types';
import { pipeline } from '@huggingface/transformers';

export class EmbeddingManager {
	private ollamaClient: OllamaEmbeddingClient;
	private vectorStore: VectorStore;
	private config: Required<EmbeddingConfig>;

	constructor(config: EmbeddingConfig = {}) {
		this.config = {
			ollamaHost: config.ollamaHost || 'http://localhost:11434',
			embeddingModel: config.embeddingModel || 'embeddinggemma:300m',
			dbPath: config.dbPath || './embeddings.db',
			embeddingDims: config.embeddingDims || 768,
			chunkSize: config.chunkSize || 2048,
			chunkOverlap: config.chunkOverlap || 100,
		};

		this.ollamaClient = new OllamaEmbeddingClient(this.config.ollamaHost, this.config.embeddingModel);
		this.vectorStore = new VectorStore(this.config.dbPath, 'documents', this.config.embeddingDims);
	}

	/**
	 * Truncate embedding to specified dimensions (Matryoshka embeddings support)
	 */
	private truncateEmbedding(embedding: number[], dims: number): number[] {
		if (embedding.length <= dims) {
			return embedding;
		}
		return embedding.slice(0, dims);
	}

	/**
	 * Simple character-based chunking
	 * Note: Token-based chunking would be more accurate but requires the model's tokenizer
	 */
	private chunkText(text: string): string[] {
		const chunks: string[] = [];
		const { chunkSize, chunkOverlap } = this.config;

		let start = 0;
		while (start < text.length) {
			const end = Math.min(start + chunkSize, text.length);
			const chunk = text.slice(start, end).trim();
			
			if (chunk.length > 0) {
				chunks.push(chunk);
			}

			if (end >= text.length) {break;}
			start = end - chunkOverlap;
		}

		return chunks;
	}

	/**
	 * Read all text files from a directory
	 */
	private readTextFilesFromDirectory(dirPath: string): Map<string, string> {
		const files = new Map<string, string>();

		if (!fs.existsSync(dirPath)) {
			throw new Error(`Directory does not exist: ${dirPath}`);
		}

		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isFile() && entry.name.endsWith('.txt')) {
				const content = fs.readFileSync(fullPath, 'utf-8');
				files.set(entry.name, content);
			}
		}

		return files;
	}

	/**
	 * Process a directory of text files and generate embeddings
	 */
	async processDirectory(dirPath: string): Promise<void> {
		console.log(`📂 Processing directory: ${dirPath}`);

		// Check if model is available
		const modelAvailable = await this.ollamaClient.checkModelAvailability();
		if (!modelAvailable) {
			throw new Error(`Model ${this.config.embeddingModel} is not available. Please pull it first with: ollama pull ${this.config.embeddingModel}`);
		}

		// Read all text files
		const files = this.readTextFilesFromDirectory(dirPath);
		console.log(`📄 Found ${files.size} text files`);

		let totalChunks = 0;
		const allChunks: DocumentChunk[] = [];

		// Process each file
		for (const [fileName, content] of files.entries()) {
			console.log(`📝 Processing: ${fileName}`);

			// Chunk the content
			const chunks = this.chunkText(content);
			console.log(`  └─ Created ${chunks.length} chunks`);

			// Generate embeddings for chunks
			const embeddings = await this.ollamaClient.generateEmbeddings(chunks);

			// Create document chunks
			for (let i = 0; i < chunks.length; i++) {
				allChunks.push({
					text: chunks[i],
					source: fileName,
					embedding: this.truncateEmbedding(embeddings[i], this.config.embeddingDims),
				});
			}

			totalChunks += chunks.length;
		}

		// Store all chunks in the vector database
		console.log(`💾 Storing ${totalChunks} chunks in vector database...`);
		this.vectorStore.insertDocuments(allChunks);

		console.log(`✅ Processing complete! Total documents: ${this.vectorStore.getDocumentCount()}`);
	}

	/**
	 * Search for similar documents
	 */
	async search(query: string, topK = 5) {
		console.log(`🔍 Searching for: "${query}"`);

		// Generate embedding for query
		const queryEmbedding = await this.ollamaClient.generateEmbedding(query);

		// Truncate to configured dimensions
		const truncatedEmbedding = this.truncateEmbedding(queryEmbedding, this.config.embeddingDims);

		// Search in vector store
		const results = this.vectorStore.search(truncatedEmbedding, topK);

		console.log(`📊 Found ${results.length} results:`);
		for (const result of results) {
			console.log(`  📄 ${result.source} (distance: ${result.distance.toFixed(4)})`);
			console.log(`     ${result.text.slice(0, 100)}...`);
		}

		return results;
	}

	/**
	 * Get statistics about the vector database
	 */
	getStats(): EmbeddingStats {
		return {
			documentCount: this.vectorStore.getDocumentCount(),
			embeddingDims: this.config.embeddingDims,
			model: this.config.embeddingModel,
		};
	}

	/**
	 * Close the vector store connection
	 */
	close() {
		this.vectorStore.close();
	}
}
