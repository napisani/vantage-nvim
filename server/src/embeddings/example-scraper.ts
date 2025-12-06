/**
 * Example usage of the WebScraper
 * 
 * This demonstrates how to:
 * 1. Create a WebScraper instance
 * 2. Scrape one or more URLs
 * 3. Save content to ./docs directory
 * 4. Integrate with EmbeddingManager
 */

import { WebScraper, EmbeddingManager } from './index';

async function main() {
	// Create a web scraper
	const scraper = new WebScraper({
		outputDir: './docs',
		headless: true,
		timeout: 30000,
		maxRetries: 3,
	});

	try {
		// Example 1: Scrape a single URL
		console.log('=== Example 1: Single URL ===\n');
		
		const singleResult = await scraper.scrapeUrl('https://example.com');
		
		if (singleResult.success) {
			console.log(`\n✅ Successfully scraped: ${singleResult.title}`);
			console.log(`   File: ${singleResult.fileName}`);
			console.log(`   Content length: ${singleResult.content.length} characters\n`);
		}

		// Example 2: Scrape multiple URLs
		console.log('\n=== Example 2: Multiple URLs ===\n');
		
		const urls = [
			'https://elixirschool.com/en/lessons/basics/basics',
			'https://elixirschool.com/en/lessons/basics/collections',
		];

		const results = await scraper.scrapeUrls(urls);

		// Show results
		console.log('\n=== Scraping Results ===');
		results.forEach((result, i) => {
			if (result.success) {
				console.log(`${i + 1}. ✅ ${result.title}`);
				console.log(`   ${result.fileName} (${result.content.length} chars)`);
			} else {
				console.log(`${i + 1}. ❌ ${result.url}`);
				console.log(`   Error: ${result.error}`);
			}
		});

		// Example 3: Integrate with EmbeddingManager
		console.log('\n\n=== Example 3: Create Embeddings from Scraped Content ===\n');
		
		const embeddingManager = new EmbeddingManager({
			ollamaHost: 'http://localhost:11434',
			embeddingModel: 'embeddinggemma:300m',
			dbPath: './data/embeddings.db',
			embeddingDims: 256,
			tokenizerModel: 'Xenova/gemma-tokenizer',
			maxTokensPerChunk: 512,
			chunkOverlapSentences: 1,
		});

		// Process the scraped documents
		await embeddingManager.processDirectory('./docs');

		// Get stats
		const stats = embeddingManager.getStats();
		console.log('\n=== Embedding Stats ===');
		console.log(stats);

		// Example search
		console.log('\n=== Search Example ===');
		const searchResults = await embeddingManager.search('What is natural language processing?', 3);

		console.log('\n=== Search Results ===');
		searchResults.forEach((result, i) => {
			console.log(`${i + 1}. ${result.source} (distance: ${result.distance.toFixed(4)})`);
			console.log(`   ${result.text.slice(0, 150)}...\n`);
		});

		// Clean up
		embeddingManager.close();

	} catch (error) {
		console.error('Error:', error);
	} finally {
		// Always close the scraper
		await scraper.close();
	}
}

// Run if this file is executed directly
if (require.main === module) {
	main().catch(console.error);
}
