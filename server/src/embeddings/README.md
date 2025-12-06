# Embeddings Module

A TypeScript module for creating and searching embeddings using Ollama's embeddinggemma:300m model and SQLite-vec for vector storage.

## Features

- 🤖 **Ollama Integration**: Uses local Ollama server for generating embeddings
- 📊 **Vector Storage**: Stores embeddings in SQLite-vec for fast similarity search
- 📁 **Batch Processing**: Process entire directories of text files
- 🔍 **Semantic Search**: Find semantically similar documents
- 🔒 **100% Private**: All processing happens locally

## Architecture

```
embeddings/
├── index.ts           # Exports for the embeddings module
├── embedding-manager.ts  # Main EmbeddingManager class
├── ollama-client.ts   # Ollama API client for embeddings
├── vector-store.ts    # SQLite-vec storage implementation
├── text-chunker.ts    # Sentence-level token-aware chunking
├── types.ts           # Type definitions
├── example.ts         # Usage examples
└── README.md          # This file
```

## Prerequisites

1. **Ollama Server**: Running with embeddinggemma:300m model
   ```bash
   docker-compose up -d
   # or if running Ollama directly:
   ollama pull embeddinggemma:300m
   ```

2. **Dependencies**: Already installed via package.json
   - `ollama` - Ollama Node.js client
   - `better-sqlite3` - SQLite database
   - `sqlite-vec` - Vector similarity extension
   - `@huggingface/transformers` - Local tokenizer for token counting
   - `natural` - NLP library for sentence tokenization

## Usage

### Basic Example

```typescript
import { EmbeddingManager } from './embeddings';

// Create an embedding manager with token-based chunking
const manager = new EmbeddingManager({
  ollamaHost: 'http://localhost:11434',
  embeddingModel: 'embeddinggemma:300m',
  dbPath: './embeddings.db',
  embeddingDims: 256,
  // Token-based chunking options
  tokenizerModel: 'Xenova/gemma-tokenizer',
  maxTokensPerChunk: 512,
  chunkOverlapSentences: 1,
});

// Process a directory of text files
await manager.processDirectory('./docs');

// Search for similar documents
const results = await manager.search('How does embedding work?', 5);

// Get stats
const stats = manager.getStats();
console.log(stats);

// Clean up
manager.close();
```

### Processing Text Files

Place `.txt` files in a directory and process them:

```typescript
await manager.processDirectory('./my-docs');
// This will:
// 1. Read all .txt files
// 2. Chunk the content (respecting chunk size and overlap)
// 3. Generate embeddings for each chunk
// 4. Store in vector database
```

### Searching

```typescript
const results = await manager.search('query text', 5);

// Results contain:
// - rowid: Database row ID
// - text: The chunk text
// - source: Original filename
// - distance: Similarity score (lower = more similar)
```

## Configuration

```typescript
interface EmbeddingConfig {
  ollamaHost?: string;           // Default: 'http://localhost:11434'
  embeddingModel?: string;       // Default: 'embeddinggemma:300m'
  dbPath?: string;               // Default: './embeddings.db'
  embeddingDims?: number;        // Default: 768 (or 256 for faster performance)
  
  // Token-based chunking options (NEW)
  tokenizerModel?: string;       // Default: 'Xenova/gemma-tokenizer'
  maxTokensPerChunk?: number;    // Default: 512 tokens
  chunkOverlapSentences?: number; // Default: 1 sentence
  
  // Legacy character-based chunking (deprecated)
  chunkSize?: number;            // Default: 2048 characters
  chunkOverlap?: number;         // Default: 100 characters
}
```

## Implementation Details

### Chunking Strategy

**Sentence-Level Token-Based Chunking** (Current Implementation):
- **Sentence Splitting**: Uses `natural` library's SentenceTokenizer
- **Token Counting**: Uses HuggingFace transformers for accurate token counting
- **Chunk Size**: 512 tokens (default) - respects model's context window
- **Overlap**: 1 sentence (default) - maintains context between chunks
- **Smart Handling**:
  - Recognizes abbreviations (Dr., Prof., Ph.D., e.g., i.e., etc.)
  - Handles decimal numbers (3.14159)
  - Preserves URLs and email addresses
  - Respects quotation marks

**Why Sentence-Level Token-Based?**
- More accurate than character-based chunking
- Respects natural language boundaries
- Ensures chunks don't exceed model's token limit
- Better semantic coherence within chunks
- Prevents splitting mid-sentence

**Legacy Character-Based Chunking**:
Still available via the `useTokenChunking` parameter for backward compatibility, but not recommended.

### Vector Dimensions

The embeddinggemma model supports Matryoshka embedding representations, allowing truncation to smaller dimensions:
- Full: 768 dimensions
- Truncated: 256 dimensions (default, 3x faster)
- Other options: 512, 128

### Storage Format

Embeddings are stored as float32 arrays in SQLite using the vec0 virtual table:
```sql
CREATE VIRTUAL TABLE documents USING vec0(
  text TEXT,
  source TEXT,
  embedding float[256]
)
```

## API Reference

### EmbeddingManager

#### `constructor(config?: EmbeddingConfig)`
Create a new embedding manager instance.

#### `async processDirectory(dirPath: string): Promise<void>`
Process all `.txt` files in a directory and store their embeddings.

#### `async search(query: string, topK?: number): Promise<SearchResult[]>`
Search for semantically similar documents.

#### `getStats(): { documentCount: number, embeddingDims: number, model: string }`
Get statistics about the vector database.

#### `close(): void`
Close the database connection.

### OllamaEmbeddingClient

#### `async generateEmbedding(text: string): Promise<number[]>`
Generate embedding for a single text.

#### `async generateEmbeddings(texts: string[]): Promise<number[][]>`
Generate embeddings for multiple texts.

#### `async checkModelAvailability(): Promise<boolean>`
Check if the embedding model is available.

### VectorStore

#### `insertDocument(chunk: DocumentChunk): void`
Insert a single document chunk.

#### `insertDocuments(chunks: DocumentChunk[]): void`
Insert multiple chunks in a transaction.

#### `search(queryEmbedding: number[], topK?: number): SearchResult[]`
Perform vector similarity search.

#### `getDocumentCount(): number`
Get the total number of stored documents.

## Running the Example

```bash
cd server
npm run build

# Run the example (make sure you have docs/ directory with .txt files)
node out/embeddings/example.js
```

## Future Enhancements

- [ ] Support for different file formats (PDF, Markdown, etc.)
- [ ] Incremental updates (only process new/changed files)
- [ ] Metadata filtering in search
- [ ] Support for other embedding models
- [ ] Batch embedding generation for better performance
- [ ] Progress callbacks for long-running operations
- [ ] Configurable sentence tokenizer abbreviations
- [ ] Multi-language sentence tokenization support

## Comparison with Python Notebook

This implementation mirrors the Python RAG notebook with these differences:

| Feature | Python Notebook | This Implementation |
|---------|----------------|---------------------|
| Embedding Model | sentence-transformers | Ollama embeddinggemma:300m |
| Chunking | Token-based | ✅ Sentence-level token-based |
| Sentence Splitting | Unknown | natural's SentenceTokenizer |
| Token Counting | sentence-transformers | HuggingFace transformers |
| Vector Store | sqlite-vec (Python) | sqlite-vec (Node.js) |
| Language | Python | TypeScript |
| LLM Integration | Ollama (Qwen) | Not yet implemented |

## License

MIT
