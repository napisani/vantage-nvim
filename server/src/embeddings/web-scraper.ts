/**
 * Web scraper using Playwright to extract text content from URLs
 * Saves scraped content as .txt files for embedding processing
 */

import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright';
import type { ScraperConfig, ScrapeResult } from './types.js';

export class WebScraper {
	private config: Required<ScraperConfig>;
	private browser: Browser | null = null;

	constructor(config: ScraperConfig = {}) {
		this.config = {
			outputDir: config.outputDir || './docs',
			headless: config.headless !== false,
			timeout: config.timeout || 30000,
			waitForSelector: config.waitForSelector || 'body',
			userAgent: config.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
			maxRetries: config.maxRetries || 3,
		};

		// Ensure output directory exists
		if (!fs.existsSync(this.config.outputDir)) {
			fs.mkdirSync(this.config.outputDir, { recursive: true });
		}
	}

	/**
	 * Initialize the browser instance
	 */
	private async initBrowser(): Promise<void> {
		if (this.browser) return;

		console.log('🌐 Launching browser...');
		this.browser = await chromium.launch({
			headless: this.config.headless,
		});
		console.log('✅ Browser launched');
	}

	/**
	 * Close the browser instance
	 */
	async close(): Promise<void> {
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
			console.log('🔒 Browser closed');
		}
	}

	/**
	 * Generate a safe filename from URL
	 */
	private urlToFilename(url: string): string {
		try {
			const urlObj = new URL(url);
			const hostname = urlObj.hostname.replace(/^www\./, '');
			const pathname = urlObj.pathname
				.replace(/\/$/, '')
				.replace(/\//g, '_')
				.replace(/[^a-zA-Z0-9_-]/g, '');

			const filename = pathname
				? `${hostname}${pathname}`
				: hostname;

			// Limit filename length and add timestamp for uniqueness
			const timestamp = Date.now();
			const truncated = filename.slice(0, 50);
			return `${truncated}_${timestamp}.txt`;
		} catch (error) {
			// Fallback for invalid URLs
			const safe = url
				.replace(/[^a-zA-Z0-9]/g, '_')
				.slice(0, 50);
			return `${safe}_${Date.now()}.txt`;
		}
	}

	/**
	 * Extract text content from a page
	 * Removes scripts, styles, and navigation elements
	 */
	private async extractContent(page: Page): Promise<{ title: string; content: string }> {
		// Use page.evaluate with a function that has proper browser context
		const result = await page.evaluate(() => {
			// @ts-ignore - Running in browser context
			const doc = document;
			
			// Remove unwanted elements
			const unwantedSelectors = [
				'script',
				'style',
				'nav',
				'header',
				'footer',
				'aside',
				'iframe',
				'noscript',
				'.advertisement',
				'.ads',
				'#cookie-banner',
				'.cookie-notice',
			];

			unwantedSelectors.forEach(selector => {
				doc.querySelectorAll(selector).forEach((el: any) => el.remove());
			});

			// Get page title
			const title = doc.title || 'Untitled';

			// Extract main content
			// Try to find main content area first
			const mainContent = 
				doc.querySelector('main') ||
				doc.querySelector('article') ||
				doc.querySelector('[role="main"]') ||
				doc.querySelector('.content') ||
				doc.querySelector('#content') ||
				doc.body;

			// Get text content and clean it up
			let text = (mainContent as any)?.innerText || '';
			
			// Clean up excessive whitespace
			text = text
				.replace(/\n\s*\n\s*\n/g, '\n\n') // Replace multiple newlines with double
				.replace(/[ \t]+/g, ' ') // Replace multiple spaces with single
				.trim();

			return { title, content: text };
		});

		return result;
	}

	/**
	 * Scrape a single URL with retry logic
	 */
	async scrapeUrl(url: string, retryCount = 0): Promise<ScrapeResult> {
		console.log(`📄 Scraping: ${url}`);

		try {
			await this.initBrowser();
			if (!this.browser) {
				throw new Error('Failed to initialize browser');
			}

			const page = await this.browser.newPage({
				userAgent: this.config.userAgent,
			});

			// Set timeout
			page.setDefaultTimeout(this.config.timeout);

			// Navigate to URL
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: this.config.timeout,
			});

			// Wait for selector if specified
			if (this.config.waitForSelector) {
				await page.waitForSelector(this.config.waitForSelector, {
					timeout: this.config.timeout,
				});
			}

			// Extract content
			const { title, content } = await this.extractContent(page);

			await page.close();

			if (!content || content.length < 100) {
				throw new Error('Extracted content is too short or empty');
			}

			// Generate filename and save
			const fileName = this.urlToFilename(url);
			const filePath = path.join(this.config.outputDir, fileName);

			// Create file content with metadata
			const fileContent = `Title: ${title}
URL: ${url}
Scraped: ${new Date().toISOString()}

---

${content}`;

			fs.writeFileSync(filePath, fileContent, 'utf-8');

			console.log(`✅ Saved: ${fileName} (${content.length} characters)`);

			return {
				url,
				title,
				content,
				fileName,
				success: true,
				scrapedAt: new Date(),
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`❌ Error scraping ${url}: ${errorMessage}`);

			// Retry logic
			if (retryCount < this.config.maxRetries) {
				console.log(`🔄 Retrying (${retryCount + 1}/${this.config.maxRetries})...`);
				await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
				return this.scrapeUrl(url, retryCount + 1);
			}

			return {
				url,
				title: '',
				content: '',
				fileName: '',
				success: false,
				error: errorMessage,
				scrapedAt: new Date(),
			};
		}
	}

	/**
	 * Scrape multiple URLs
	 */
	async scrapeUrls(urls: string[]): Promise<ScrapeResult[]> {
		console.log(`🚀 Starting scrape of ${urls.length} URLs\n`);

		const results: ScrapeResult[] = [];

		for (const url of urls) {
			const result = await this.scrapeUrl(url);
			results.push(result);
			
			// Brief delay between requests to be polite
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		// Summary
		const successful = results.filter(r => r.success).length;
		const failed = results.filter(r => !r.success).length;

		console.log(`\n📊 Scraping complete:`);
		console.log(`  ✅ Success: ${successful}`);
		console.log(`  ❌ Failed: ${failed}`);

		return results;
	}

	/**
	 * Get configuration
	 */
	getConfig(): Required<ScraperConfig> {
		return { ...this.config };
	}
}
