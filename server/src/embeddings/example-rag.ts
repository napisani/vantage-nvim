/**
 * Example script demonstrating RAG (Retrieval-Augmented Generation)
 * 
 * This script shows how to:
 * 1. Initialize the EmbeddingManager with existing embeddings
 * 2. Create a RAGModule for question answering
 * 3. Perform RAG queries (semantic search + LLM completion)
 * 4. Use both standard and streaming responses
 * 
 * Prerequisites:
 * - Documents have been embedded using example.ts
 * - Ollama is running with gemma:2b model
 * - Run: ollama pull gemma:2b
 */

import { EmbeddingManager } from './embedding-manager.js';
import { RAGModule } from './rag.js';

async function main() {
	console.log('🤖 RAG Demo - Question Answering with Context Retrieval\n');
	console.log('=' .repeat(60));

	// Step 1: Initialize EmbeddingManager
	console.log('\n📚 Initializing EmbeddingManager...');
	const embeddingManager = new EmbeddingManager({
		dbPath: './embeddings.db',
		ollamaHost: 'http://localhost:11434',
		embeddingModel: 'embeddinggemma:300m'
	});

	// Check if we have any documents
	const stats = embeddingManager.getStats();
	console.log(`   ✓ Found ${stats.documentCount} documents in database`);
	
	if (stats.documentCount === 0) {
		console.error('\n❌ No documents found in database!');
		console.log('   Please run example.ts first to add documents.');
		console.log('   Example: npm run example');
		process.exit(1);
	}

	// Step 2: Initialize RAGModule
	console.log('\n🧠 Initializing RAG Module...');
	const rag = new RAGModule(embeddingManager, {
		completionModel: 'gemma:2b', // Using available model
		topK: 3,
		temperature: 0.7
	});

	// Check model availability
	const modelAvailable = await rag.checkModelAvailability();
	if (!modelAvailable) {
		console.error('\n❌ Model gemma:2b not found!');
		console.log('   Please pull the model first:');
		console.log('   ollama pull gemma:2b');
		process.exit(1);
	}
	console.log('   ✓ gemma:2b model is available');

	// Demo questions
	const questions = [
		"how do you define an atom",
	];

	// Step 3: Perform RAG queries
	console.log('\n' + '='.repeat(60));
	console.log('💬 Running RAG Queries\n');

	for (let i = 0; i < questions.length; i++) {
		const question = questions[i];
		
		console.log(`\nQuestion ${i + 1}: ${question}`);
		console.log('-'.repeat(60));

		try {
			// First, show retrieved contexts
			console.log('\n📄 Retrieved Contexts:');
			const contexts = await rag.getContexts(question, 3);
			
			contexts.forEach((ctx, idx) => {
				console.log(`\n   [${idx + 1}] Source: ${ctx.source} (distance: ${ctx.distance.toFixed(4)})`);
				console.log(`       ${ctx.text.substring(0, 150)}...`);
			});

			// Then, get the RAG answer
			console.log('\n🤖 Answer:');
			const result = await rag.query(question, 3);
			console.log(`\n${result.answer}\n`);
			
			if (result.tokensUsed) {
				console.log(`   📊 Tokens used: ${result.tokensUsed}`);
			}
			console.log(`   📦 Model: ${result.model}`);
			
		} catch (error) {
			console.error(`\n❌ Error: ${error}`);
		}

		if (i < questions.length - 1) {
			console.log('\n' + '='.repeat(60));
		}
	}

	// Step 4: Demo streaming response
	console.log('\n' + '='.repeat(60));
	console.log('🌊 Streaming RAG Query Demo\n');

	const streamQuestion = "Explain how this RAG system works";
	console.log(`Question: ${streamQuestion}`);
	console.log('-'.repeat(60));
	console.log('\n🤖 Streaming Answer:\n');

	try {
		await rag.queryStream(
			streamQuestion,
			(chunk) => {
				process.stdout.write(chunk);
			},
			3
		);
		console.log('\n');
	} catch (error) {
		console.error(`\n❌ Streaming error: ${error}`);
	}

	console.log('\n' + '='.repeat(60));
	console.log('✅ RAG Demo Complete!\n');
}

// Run the example
main().catch(console.error);
