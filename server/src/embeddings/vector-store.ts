/**
 * SQLite-vec storage for embedding vectors
 */

import Database = require('better-sqlite3');
import * as sqliteVec from 'sqlite-vec';
import * as fs from 'fs';
import * as path from 'path';
import type { DocumentChunk, SearchResult } from './types';

export class VectorStore {
	private db: Database.Database;
	private tableName: string;
	private embeddingDims: number;

	constructor(dbPath: string, tableName: string = 'documents', embeddingDims: number = 256) {
		// Ensure directory exists
		const dbDir = path.dirname(dbPath);
		if (!fs.existsSync(dbDir)) {
			fs.mkdirSync(dbDir, { recursive: true });
		}

		this.db = new Database(dbPath);
		this.tableName = tableName;
		this.embeddingDims = embeddingDims;

		// Load sqlite-vec extension
		sqliteVec.load(this.db);

		// Initialize the vector table
		this.initializeTable();
	}

	/**
	 * Initialize the vector table
	 */
	private initializeTable(): void {
		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
				text TEXT,
				source TEXT,
				embedding float[${this.embeddingDims}]
			)
		`);
	}

	/**
	 * Serialize float array to bytes for SQLite storage
	 */
	private serializeF32(vector: number[]): Buffer {
		const buffer = Buffer.allocUnsafe(vector.length * 4);
		for (let i = 0; i < vector.length; i++) {
			buffer.writeFloatLE(vector[i], i * 4);
		}
		return buffer;
	}

	/**
	 * Insert a document chunk with its embedding
	 */
	insertDocument(chunk: DocumentChunk): void {
		if (!chunk.embedding) {
			throw new Error('Embedding is required for insertion');
		}

		const stmt = this.db.prepare(`
			INSERT INTO ${this.tableName} (text, source, embedding)
			VALUES (?, ?, ?)
		`);

		stmt.run(chunk.text, chunk.source, this.serializeF32(chunk.embedding));
	}

	/**
	 * Insert multiple document chunks in a transaction
	 */
	insertDocuments(chunks: DocumentChunk[]): void {
		const insert = this.db.transaction((chunks: DocumentChunk[]) => {
			for (const chunk of chunks) {
				this.insertDocument(chunk);
			}
		});

		insert(chunks);
	}

	/**
	 * Perform semantic search
	 */
	search(queryEmbedding: number[], topK: number = 5): SearchResult[] {
		const stmt = this.db.prepare(`
			SELECT rowid, text, source, distance
			FROM ${this.tableName}
			WHERE embedding MATCH ?
			ORDER BY distance
			LIMIT ?
		`);

		const results = stmt.all(this.serializeF32(queryEmbedding), topK) as SearchResult[];
		return results;
	}

	/**
	 * Get document count
	 */
	getDocumentCount(): number {
		const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`).get() as { count: number };
		return result.count;
	}

	/**
	 * Clear all documents
	 */
	clearDocuments(): void {
		this.db.exec(`DELETE FROM ${this.tableName}`);
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		this.db.close();
	}
}
