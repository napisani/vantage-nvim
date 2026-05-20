#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function argValue(name) {
	const index = process.argv.indexOf(name);
	if (index === -1 || index + 1 >= process.argv.length) {
		return null;
	}

	return process.argv[index + 1];
}

function writeFile(filePath, content) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, 'utf8');
}

const outputPath = argValue('--output-last-message');
if (!outputPath) {
	console.error('codex-stub expected --output-last-message <path>');
	process.exit(2);
}

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
	prompt += chunk;
});

process.stdin.on('end', () => {
	const promptPath = process.env.CODEX_STUB_TRACE_PROMPT_PATH || process.env.CODEX_STUB_TRACE_PROMPT_PATH;
	if (promptPath) {
		writeFile(promptPath, prompt);
	}

	const response = {
		annotations: [
			{
				range: {
					startLine: 0,
					startCharacter: 0,
					endLine: 0,
					endCharacter: 14,
				},
				text: 'E2E annotation from Codex stub.',
				severity: 'info',
				detailMarkdown: '## E2E Annotation\n\nThe Codex stub verified the annotation plumbing.',
			},
		],
	};

	writeFile(outputPath, JSON.stringify(response));
});
