/**
 * Embeddings module
 * 
 * Exports for creating and searching embeddings using Ollama and SQLite-vec
 */

// Export types
export type {
	EmbeddingConfig,
	DocumentChunk,
	SearchResult,
	EmbeddingResult,
	EmbeddingStats,
	ChunkingConfig,
	ScraperConfig,
	ScrapeResult,
	RAGConfig,
	RAGResult,
} from './types';

// Export classes
export { EmbeddingManager } from './embedding-manager';
export { OllamaEmbeddingClient } from './ollama-client';
export { VectorStore } from './vector-store';
export { TextChunker } from './text-chunker';
export { WebScraper } from './web-scraper';
export { RAGModule } from './rag';
