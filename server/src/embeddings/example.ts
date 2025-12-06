/**
 * Example usage of the embeddings module
 * 
 * This demonstrates how to:
 * 1. Create an EmbeddingManager instance
 * 2. Process a directory of text files
 * 3. Search for similar documents
 */

import { EmbeddingManager } from './index';

async function main() {
	// Create an embedding manager with default config
	// embeddingDims: 768 (full), 256 (3x faster with truncation), 512, or 128
	const embeddingManager = new EmbeddingManager({
		ollamaHost: 'http://localhost:11434',
		embeddingModel: 'embeddinggemma:300m',
		dbPath: './data/embeddings.db',
		embeddingDims: 256,  // Using 256 dimensions for faster performance
		chunkSize: 2048,
		chunkOverlap: 100,
	});

	try {
		// Example 1: Process a directory of text files
		console.log('=== Processing Directory ===');
    // print pwd
    console.log('Current directory:', process.cwd());
		await embeddingManager.processDirectory('./docs');

		// Example 2: Get stats
		console.log('\n=== Database Stats ===');
		const stats = embeddingManager.getStats();
		console.log(stats);

		// Example 3: Search for similar documents
		console.log('\n=== Search Example ===');
		const results = await embeddingManager.search('How does vector similarity work?', 3);

		console.log('\n=== Search Results ===');
		for (const result of results) {
			console.log(`Source: ${result.source}`);
			console.log(`Distance: ${result.distance}`);
			console.log(`Text: ${result.text.slice(0, 200)}...\n`);
		}

	} catch (error) {
		console.error('Error:', error);
	} finally {
		// Always close the connection
		embeddingManager.close();
	}
}

// Run if this file is executed directly
if (require.main === module) {
	main().catch(console.error);
}
