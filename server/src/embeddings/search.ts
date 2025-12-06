/**
 * Search script for embeddings
 * 
 * Usage: npm run search "your search query"
 * 
 * Searches the embeddings database and returns top 5 results
 */

import { EmbeddingManager } from './index';

async function main() {
	// Get search query from command line arguments
	const args = process.argv.slice(2);
	
	if (args.length === 0) {
		console.error('Error: Please provide a search query');
		console.error('Usage: npm run search "your search query"');
		process.exit(1);
	}

	const query = args.join(' ');

	console.log('🔍 Searching embeddings...\n');
	console.log(`Query: "${query}"`);
	console.log('─'.repeat(80));

	// Create embedding manager
	const manager = new EmbeddingManager({
		ollamaHost: 'http://localhost:11434',
		embeddingModel: 'embeddinggemma:300m',
		dbPath: './data/embeddings.db',
		embeddingDims: 256,
	});

	try {
		// Check if database has any documents
		const stats = manager.getStats();
		
		if (stats.documentCount === 0) {
			console.error('\n❌ No documents found in the embeddings database');
			console.error('   Please run: npm run example:embeddings');
			console.error('   Or scrape some URLs: npm run example:scraper');
			process.exit(1);
		}

		console.log(`\nDatabase: ${stats.documentCount} documents, ${stats.embeddingDims} dimensions`);
		console.log(`Model: ${stats.model}`);
		console.log('─'.repeat(80));

		// Search
		const results = await manager.search(query, 5);

		if (results.length === 0) {
			console.log('\n❌ No results found');
			process.exit(0);
		}

		// Display results
		console.log(`\n✅ Found ${results.length} results:\n`);

		results.forEach((result, index) => {
			console.log(`${index + 1}. Source: ${result.source}`);
			console.log(`   Distance: ${result.distance.toFixed(4)} (lower = more similar)`);
			console.log(`   Preview: ${result.text.slice(0, 200).replace(/\n/g, ' ')}...`);
			console.log('');
		});

		console.log('─'.repeat(80));

	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
		process.exit(1);
	} finally {
		manager.close();
	}
}

// Run the search
main().catch(error => {
	console.error('Fatal error:', error);
	process.exit(1);
});
