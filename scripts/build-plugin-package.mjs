import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.plugin-dist');

const requiredDirectories = [
	['plugin', 'plugin'],
	['lua', 'lua'],
	['server/out', 'server/out', runtimeBackendFilter],
];

const requiredFiles = [
	'README.md',
	'package.json',
	'package-lock.json',
];

const optionalFiles = [
	'LICENSE',
];

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

for (const [source, destination, filter] of requiredDirectories) {
	await copyDirectory(source, destination, filter);
}

for (const file of requiredFiles) {
	await copyFile(file, file);
}

for (const file of optionalFiles) {
	if (await exists(path.join(root, file))) {
		await copyFile(file, file);
	}
}

console.log(`Built plugin package at ${path.relative(root, output)}`);

async function copyDirectory(sourceRelative, destinationRelative, filter) {
	const source = path.join(root, sourceRelative);
	const destination = path.join(output, destinationRelative);
	await assertExists(source, `${sourceRelative} does not exist. Run npm run compile before packaging.`);
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.cp(source, destination, { recursive: true, filter });
}

async function copyFile(sourceRelative, destinationRelative) {
	const source = path.join(root, sourceRelative);
	const destination = path.join(output, destinationRelative);
	await assertExists(source, `${sourceRelative} does not exist.`);
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.copyFile(source, destination);
}

async function assertExists(filePath, message) {
	if (!(await exists(filePath))) {
		throw new Error(message);
	}
}

async function exists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function runtimeBackendFilter(source) {
	return !source.endsWith('.map') && !source.endsWith('.test.js');
}
