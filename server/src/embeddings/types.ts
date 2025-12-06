/**
 * Type definitions for the embeddings module
 */

export interface EmbeddingConfig {
	ollamaHost?: string;
	embeddingModel?: string;
	dbPath?: string;
	embeddingDims?: number;
	chunkSize?: number;
	chunkOverlap?: number;
}

export interface DocumentChunk {
	text: string;
	source: string;
	embedding?: number[];
}

export interface SearchResult {
	rowid: number;
	text: string;
	source: string;
	distance: number;
}

export interface EmbeddingResult {
	embedding: number[];
	model: string;
}

export interface EmbeddingStats {
	documentCount: number;
	embeddingDims: number;
	model: string;
}
