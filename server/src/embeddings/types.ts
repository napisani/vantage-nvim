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
	// Token-based chunking options
	tokenizerModel?: string; // HuggingFace tokenizer model (e.g., 'Xenova/gemma-tokenizer')
	maxTokensPerChunk?: number; // Maximum tokens per chunk (default: 512)
	chunkOverlapSentences?: number; // Number of sentences to overlap between chunks (default: 1)
}

export interface ChunkingConfig {
	tokenizerModel: string;
	maxTokensPerChunk: number;
	chunkOverlapSentences: number;
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

export interface ScraperConfig {
	outputDir?: string; // Output directory for scraped content (default: './docs')
	headless?: boolean; // Run browser in headless mode (default: true)
	timeout?: number; // Page load timeout in ms (default: 30000)
	waitForSelector?: string; // Wait for specific selector before scraping
	userAgent?: string; // Custom user agent
	maxRetries?: number; // Maximum number of retries on failure (default: 3)
}

export interface ScrapeResult {
	url: string;
	title: string;
	content: string;
	fileName: string;
	success: boolean;
	error?: string;
	scrapedAt: Date;
}

export interface RAGConfig {
	ollamaHost?: string; // Ollama host URL (default: 'http://localhost:11434')
	completionModel?: string; // Model to use for completions (default: 'gemma2:2b')
	topK?: number; // Number of documents to retrieve (default: 3)
	temperature?: number; // Temperature for generation (default: 0.7)
	systemPrompt?: string; // Custom system prompt for RAG
}

export interface RAGResult {
	question: string;
	answer: string;
	contexts: SearchResult[];
	model: string;
	tokensUsed?: number;
}
