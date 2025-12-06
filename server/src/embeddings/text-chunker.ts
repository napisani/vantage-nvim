/**
 * Sentence-level token-aware text chunking
 * Uses local tokenizer for accurate token counting
 * Chunks at sentence boundaries, respecting token limits
 */

import * as natural from 'natural';
import { AutoTokenizer, PreTrainedTokenizer } from '@huggingface/transformers';
import type { ChunkingConfig, DocumentChunk } from './types.js';

export class TextChunker {
	private config: ChunkingConfig;
	private tokenizer: PreTrainedTokenizer | null = null;
	private sentenceTokenizer: natural.SentenceTokenizer;
	private initPromise: Promise<void> | null = null;

	constructor(config: Partial<ChunkingConfig> = {}) {
		this.config = {
			tokenizerModel: config.tokenizerModel ?? 'Xenova/gemma-tokenizer',
			maxTokensPerChunk: config.maxTokensPerChunk ?? 512,
			chunkOverlapSentences: config.chunkOverlapSentences ?? 1,
		};
		
		// Initialize sentence tokenizer with common abbreviations
		const abbreviations = ['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Sr.', 'Jr.', 'e.g.', 'i.e.', 'vs.', 'etc.'];
		this.sentenceTokenizer = new natural.SentenceTokenizer(abbreviations);
	}

	/**
	 * Lazy initialization of tokenizer
	 */
	private async initialize(): Promise<void> {
		if (this.tokenizer) return;

		if (!this.initPromise) {
			this.initPromise = (async () => {
				console.log(`Loading tokenizer: ${this.config.tokenizerModel}`);
				this.tokenizer = await AutoTokenizer.from_pretrained(
					this.config.tokenizerModel
				);
				console.log('Tokenizer loaded successfully');
			})();
		}

		await this.initPromise;
	}

	/**
	 * Count tokens in text using the loaded tokenizer
	 */
	private async countTokens(text: string): Promise<number> {
		await this.initialize();
		if (!this.tokenizer) {
			throw new Error('Tokenizer not initialized');
		}

		const encoded = await this.tokenizer(text);
		return encoded.input_ids.size;
	}

	/**
	 * Split text into sentences using natural's SentenceTokenizer
	 */
	private splitIntoSentences(text: string): string[] {
		const sentences = this.sentenceTokenizer.tokenize(text);
		return sentences
			.map((sentence) => sentence.trim())
			.filter((sentence) => sentence.length > 0);
	}

	/**
	 * Chunk text at sentence boundaries with token-aware sizing
	 * 
	 * @param text - Text to chunk
	 * @param source - Source identifier for the chunks
	 * @returns Array of document chunks
	 */
	async chunkText(text: string, source: string): Promise<DocumentChunk[]> {
		await this.initialize();

		const sentences = this.splitIntoSentences(text);
		if (sentences.length === 0) {
			return [];
		}

		const chunks: DocumentChunk[] = [];
		let currentChunk: string[] = [];
		let currentTokenCount = 0;

		for (let i = 0; i < sentences.length; i++) {
			const sentence = sentences[i];
			const sentenceTokens = await this.countTokens(sentence);

			// If adding this sentence exceeds the limit, save current chunk
			if (
				currentTokenCount + sentenceTokens > this.config.maxTokensPerChunk &&
				currentChunk.length > 0
			) {
				chunks.push({
					text: currentChunk.join(' '),
					source,
				});

				// Create overlap by keeping last N sentences
				const overlapSentences = currentChunk.slice(
					-this.config.chunkOverlapSentences
				);
				currentChunk = [...overlapSentences];

				// Recalculate token count for overlap
				currentTokenCount = 0;
				for (const s of overlapSentences) {
					currentTokenCount += await this.countTokens(s);
				}
			}

			// Add the sentence to current chunk
			currentChunk.push(sentence);
			currentTokenCount += sentenceTokens;
		}

		// Add remaining sentences as final chunk
		if (currentChunk.length > 0) {
			chunks.push({
				text: currentChunk.join(' '),
				source,
			});
		}

		return chunks;
	}

	/**
	 * Process multiple documents in batch
	 */
	async chunkDocuments(
		documents: Array<{ text: string; source: string }>
	): Promise<DocumentChunk[]> {
		const allChunks: DocumentChunk[] = [];

		for (const doc of documents) {
			const chunks = await this.chunkText(doc.text, doc.source);
			allChunks.push(...chunks);
		}

		return allChunks;
	}

	/**
	 * Get current configuration
	 */
	getConfig(): ChunkingConfig {
		return { ...this.config };
	}
}
