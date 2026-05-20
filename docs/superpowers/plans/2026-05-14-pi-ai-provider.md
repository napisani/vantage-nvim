# Pi AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `VANTAGE_PROVIDER=pi` backend provider that uses `@earendil-works/pi-ai` for Vantage's existing explain, annotate, and review commands.

**Architecture:** Treat Pi as a single-request LLM abstraction layer, not as a full coding-agent session. Vantage continues to own editor context, prompt construction, response parsing, timeouts, traces, and command UX. The Pi provider adapts Vantage prompts to `@earendil-works/pi-ai` and returns the same `BackendProvider` results as Codex, Ollama, and ChatGPT.

**Tech Stack:** TypeScript, Node test runner, `@earendil-works/pi-ai`, existing Vantage Neovim stdio backend.

---

## Context7 Findings

Context7 found three relevant Pi surfaces:

- `@earendil-works/pi-ai`: lower-level unified model API with `getModel`, `complete`, `completeSimple`, `stream`, and `streamSimple`.
- `@earendil-works/pi-coding-agent`: higher-level SDK with `createAgentSession`, `AuthStorage`, `ModelRegistry`, and `SessionManager`.
- `pi` CLI/RPC: `pi -p "..."` for one-shot prompts and `pi --mode rpc --no-session` for JSON stdin/stdout integration.

For Vantage's current provider contract, use `@earendil-works/pi-ai`. Do not use `createAgentSession` in this first pass.

## File Structure

- Create `server/src/neovim/pi-provider.ts`
  - Implements `BackendProvider`.
  - Wraps Pi's model completion API behind an injectable `PiRuntime`.
  - Reuses `buildExplainPrompt`, `buildAnnotationPrompt`, `buildReviewPrompt`, `parseAnnotationResponse`, and `annotationLineOffset`.
- Create `server/src/neovim/pi-provider.test.ts`
  - Covers default provider/model, env auth precedence, annotation parsing, timeout routing, and trace files.
- Modify `server/src/neovim/provider-factory.ts`
  - Adds `VANTAGE_PROVIDER=pi`.
  - Adds `VANTAGE_PI_*` env fields.
- Modify `server/src/neovim/provider-factory.test.ts`
  - Adds Pi provider selection and override tests.
- Modify `nvim/dev/init.lua`
  - Treats `VANTAGE_DEV_PROVIDER=pi` as stdio-backed.
- Modify `nvim/tests/dev_init_spec.lua`
  - Includes `pi` in the dev-provider stdio expectation.
- Modify `lua/vantage/commands.lua`
  - Shows Pi provider/model in annotation progress notifications.
- Modify `Makefile`
  - Adds `run-pi` and `test-dev-init-pi`.
- Modify `README.md`
  - Adds Pi provider setup and run instructions.
- Modify `package.json` and `package-lock.json`
  - Adds `@earendil-works/pi-ai`.

## Environment Contract

Use these variables:

- `VANTAGE_PROVIDER=pi`
- `VANTAGE_DEV_PROVIDER=pi`
- `VANTAGE_PI_PROVIDER=openai`
- `VANTAGE_PI_MODEL=gpt-4o-mini`
- `VANTAGE_PI_API_KEY`
- `VANTAGE_PI_TIMEOUT_MS`
- `VANTAGE_PI_ANNOTATION_TIMEOUT_MS`
- `VANTAGE_PI_TRACE_PROMPT_PATH`
- `VANTAGE_PI_TRACE_RESPONSE_PATH`

Default provider/model:

- Provider: `openai`
- Model: `gpt-4o-mini`

API key precedence:

1. Explicit provider option `apiKey`
2. `VANTAGE_PI_API_KEY`
3. `OPENAI_API_KEY` when `VANTAGE_PI_PROVIDER=openai`

## Task 1: Add Pi Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the dependency**

Run:

```bash
npm install @earendil-works/pi-ai
```

Expected: `package.json` contains `@earendil-works/pi-ai` under `dependencies`, and `package-lock.json` is updated.

- [ ] **Step 2: Compile to verify package types are available**

Run:

```bash
npm run compile
```

Expected: PASS.

## Task 2: Add PiProvider Tests

**Files:**
- Create: `server/src/neovim/pi-provider.test.ts`
- Create later: `server/src/neovim/pi-provider.ts`

- [ ] **Step 1: Write failing provider tests**

Create `server/src/neovim/pi-provider.test.ts`:

```typescript
import * as test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PiProvider, type PiCompleteOptions, type PiRuntime } from './pi-provider';

interface RuntimeCall {
	prompt: string;
	options: PiCompleteOptions;
}

class RecordingPiRuntime implements PiRuntime {
	readonly calls: RuntimeCall[] = [];
	constructor(private readonly content: string) {}

	async complete(prompt: string, options: PiCompleteOptions): Promise<string> {
		this.calls.push({ prompt, options });
		return this.content;
	}
}

test('PiProvider explainSelection uses openai gpt-4o-mini by default', async () => {
	const runtime = new RecordingPiRuntime('## Pi explanation');
	const provider = new PiProvider({ apiKey: 'sk-test', runtime });

	const result = await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(provider.provider, 'openai');
	assert.equal(provider.model, 'gpt-4o-mini');
	assert.equal(provider.timeoutMs, 300_000);
	assert.equal(result.markdown, '## Pi explanation');
	assert.equal(runtime.calls[0].options.apiKey, 'sk-test');
	assert.equal(runtime.calls[0].options.provider, 'openai');
	assert.equal(runtime.calls[0].options.model, 'gpt-4o-mini');
	assert.equal(runtime.calls[0].options.timeoutMs, 300_000);
	assert.equal(runtime.calls[0].options.maxTokens, 1024);
	assert.match(runtime.calls[0].prompt, /Explain the selected code/i);
	assert.match(runtime.calls[0].prompt, /const value = 1;/);
});

test('PiProvider annotateRange parses JSON and uses annotation timeout', async () => {
	const runtime = new RecordingPiRuntime(JSON.stringify({
		annotations: [
			{
				line: 1,
				text: 'second reuses first in the addition',
				severity: 'info',
			},
		],
	}));
	const provider = new PiProvider({
		apiKey: 'sk-test',
		provider: 'openai',
		model: 'gpt-test-mini',
		annotationTimeoutMs: 12_345,
		runtime,
	});

	const result = await provider.annotateRange({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const first = 1;\nconst second = first + 1;',
		cursor: { line: 40, character: 0 },
		visibleRange: { startLine: 40, startCharacter: 0, endLine: 41, endCharacter: 25 },
		scopeText: 'const first = 1;\nconst second = first + 1;',
		candidateLines: [
			{ line: 0, text: 'const first = 1;' },
			{ line: 1, text: 'const second = first + 1;' },
		],
	});

	assert.deepEqual(result.annotations[0].range, {
		startLine: 41,
		startCharacter: 0,
		endLine: 41,
		endCharacter: 25,
	});
	assert.equal(result.telemetry?.provider, 'pi');
	assert.equal(result.telemetry?.model, 'openai/gpt-test-mini');
	assert.equal(runtime.calls[0].options.timeoutMs, 12_345);
	assert.equal(runtime.calls[0].options.maxTokens, 256);
	assert.match(runtime.calls[0].prompt, /Candidate lines to annotate/i);
	assert.match(runtime.calls[0].prompt, /1\| const second = first \+ 1;/);
});

test('PiProvider reads API key from provider environment before provider-specific fallback', async () => {
	const runtime = new RecordingPiRuntime('## From env');
	const provider = new PiProvider({
		env: { VANTAGE_PI_API_KEY: 'sk-vantage-pi', OPENAI_API_KEY: 'sk-openai' },
		runtime,
	});

	await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(runtime.calls[0].options.apiKey, 'sk-vantage-pi');
});

test('PiProvider falls back to OPENAI_API_KEY for openai models', async () => {
	const runtime = new RecordingPiRuntime('## From OpenAI env');
	const provider = new PiProvider({
		env: { OPENAI_API_KEY: 'sk-openai' },
		runtime,
	});

	await provider.explainSelection({
		filePath: '/repo/example.ts',
		language: 'typescript',
		text: 'const value = 1;',
		cursor: { line: 0, character: 0 },
		selectedText: 'const value = 1;',
	});

	assert.equal(runtime.calls[0].options.apiKey, 'sk-openai');
});

test('PiProvider requires an API key before making a request', async () => {
	const runtime = new RecordingPiRuntime('unused');
	const provider = new PiProvider({ env: {}, runtime });

	await assert.rejects(
		() =>
			provider.reviewCurrentHunk({
				filePath: '/repo/example.ts',
				language: 'typescript',
				text: 'const value = 1;',
				cursor: { line: 0, character: 0 },
				hunkText: 'const value = 1;',
			}),
		/Pi provider requires VANTAGE_PI_API_KEY or OPENAI_API_KEY/
	);
	assert.equal(runtime.calls.length, 0);
});

test('PiProvider writes prompt and raw response traces when configured', async () => {
	const traceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vantage-pi-trace-'));
	const tracePromptPath = path.join(traceDirectory, 'prompt.txt');
	const traceResponsePath = path.join(traceDirectory, 'response.txt');
	const rawResponse = JSON.stringify({
		annotations: [
			{
				range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 16 },
				text: 'Trace annotation',
				severity: 'info',
			},
		],
	});
	try {
		const provider = new PiProvider({
			apiKey: 'sk-test',
			tracePromptPath,
			traceResponsePath,
			runtime: new RecordingPiRuntime(rawResponse),
		});

		await provider.annotateRange({
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const value = 1;',
			cursor: { line: 0, character: 0 },
			scopeText: 'const value = 1;',
		});

		const prompt = await fs.readFile(tracePromptPath, 'utf8');
		const response = await fs.readFile(traceResponsePath, 'utf8');
		assert.match(prompt, /const value = 1;/);
		assert.equal(response, rawResponse);
	} finally {
		await fs.rm(traceDirectory, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:backend
```

Expected: FAIL because `./pi-provider` does not exist.

## Task 3: Implement PiProvider

**Files:**
- Create: `server/src/neovim/pi-provider.ts`

- [ ] **Step 1: Add the provider implementation**

Create `server/src/neovim/pi-provider.ts`:

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { completeSimple, getModel } from '@earendil-works/pi-ai';
import type {
	AnnotateRangeParams,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	ReviewCurrentHunkParams,
	ReviewResult,
} from './protocol';
import type { BackendProvider, ProviderRequestContext } from './provider';
import {
	annotationLineOffset,
	buildAnnotationPrompt,
	buildExplainPrompt,
	buildReviewPrompt,
	parseAnnotationResponse,
} from './model-contract';

export interface PiProviderOptions {
	apiKey?: string;
	provider?: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	annotationTimeoutMs?: number;
	tracePromptPath?: string;
	traceResponsePath?: string;
	runtime?: PiRuntime;
}

export interface PiCompleteOptions {
	apiKey: string;
	provider: string;
	model: string;
	timeoutMs: number;
	maxTokens: number;
	temperature: number;
	signal?: AbortSignal;
}

export interface PiRuntime {
	complete(prompt: string, options: PiCompleteOptions): Promise<string>;
}

interface RunPiOptions {
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

interface RunPiResult {
	content: string;
	telemetry: {
		provider: 'pi';
		model: string;
		promptChars: number;
		promptLines: number;
		elapsedMs: number;
	};
}

export class PiProvider implements BackendProvider {
	readonly provider: string;
	readonly model: string;
	readonly timeoutMs: number;
	readonly annotationTimeoutMs: number;
	readonly tracePromptPath?: string;
	readonly traceResponsePath?: string;
	private readonly apiKey?: string;
	private readonly runtime: PiRuntime;

	constructor(options: PiProviderOptions = {}) {
		const env = options.env ?? process.env;
		this.provider = options.provider ?? 'openai';
		this.model = options.model ?? 'gpt-4o-mini';
		this.apiKey = firstNonEmpty(options.apiKey, env.VANTAGE_PI_API_KEY, providerApiKey(this.provider, env));
		this.timeoutMs = options.timeoutMs ?? 300_000;
		this.annotationTimeoutMs = options.annotationTimeoutMs ?? 30_000;
		this.tracePromptPath = options.tracePromptPath;
		this.traceResponsePath = options.traceResponsePath;
		this.runtime = options.runtime ?? new PiAiRuntime();
	}

	async explainSelection(params: ExplainSelectionParams, context: ProviderRequestContext = {}): Promise<ExplanationResult> {
		const { content: markdown } = await this.runPi(buildExplainPrompt(params), { signal: context.signal });
		return {
			kind: 'explanation',
			markdown,
		};
	}

	async annotateRange(params: AnnotateRangeParams, context: ProviderRequestContext = {}): Promise<AnnotationResult> {
		const { content, telemetry } = await this.runPi(buildAnnotationPrompt(params), {
			maxTokens: 256,
			timeoutMs: this.annotationTimeoutMs,
			signal: context.signal,
		});
		return {
			kind: 'annotations',
			annotations: parseAnnotationResponse(content, annotationLineOffset(params), 'Pi', params.candidateLines),
			telemetry,
		};
	}

	async reviewCurrentHunk(params: ReviewCurrentHunkParams, context: ProviderRequestContext = {}): Promise<ReviewResult> {
		const { content: markdown } = await this.runPi(buildReviewPrompt(params), { signal: context.signal });
		return {
			kind: 'review',
			markdown,
			findings: [],
		};
	}

	private async runPi(prompt: string, options: RunPiOptions = {}): Promise<RunPiResult> {
		const apiKey = requireApiKey(this.apiKey, this.provider);
		await writeOptionalTrace(this.tracePromptPath, prompt);
		const startedAt = Date.now();
		const content = await this.runtime.complete(prompt, {
			apiKey,
			provider: this.provider,
			model: this.model,
			timeoutMs: options.timeoutMs ?? this.timeoutMs,
			maxTokens: options.maxTokens ?? 1024,
			temperature: 0.1,
			signal: options.signal,
		});

		if (content.trim().length === 0) {
			throw new Error('Pi produced an empty response.');
		}

		await writeOptionalTrace(this.traceResponsePath, content);
		return {
			content: content.trim(),
			telemetry: {
				provider: 'pi',
				model: `${this.provider}/${this.model}`,
				promptChars: prompt.length,
				promptLines: prompt.split('\n').length,
				elapsedMs: Date.now() - startedAt,
			},
		};
	}
}

export class PiAiRuntime implements PiRuntime {
	async complete(prompt: string, options: PiCompleteOptions): Promise<string> {
		const model = getModel(options.provider, options.model);
		if (!model) {
			throw new Error(`Pi model not found: ${options.provider}/${options.model}`);
		}

		const response = await completeSimple(model, {
			system: 'You are a concise code assistant inside Neovim.',
			messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
			tools: [],
		}, {
			apiKey: options.apiKey,
			reasoning: 'off',
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			timeoutMs: options.timeoutMs,
			signal: options.signal,
		});

		return extractPiText(response);
	}
}

function extractPiText(response: unknown): string {
	if (isRecord(response)) {
		const content = response.content;
		if (Array.isArray(content)) {
			const blocks = content
				.map((block) => isRecord(block) && typeof block.text === 'string' ? block.text : '')
				.filter((text) => text.length > 0);
			if (blocks.length > 0) {
				return blocks.join('\n');
			}
		}
	}

	return '';
}

function providerApiKey(provider: string, env: NodeJS.ProcessEnv): string | undefined {
	if (provider === 'openai') {
		return env.OPENAI_API_KEY;
	}
	return undefined;
}

function requireApiKey(value: string | undefined, provider: string): string {
	const apiKey = firstNonEmpty(value);
	if (!apiKey) {
		const fallback = provider === 'openai' ? ' or OPENAI_API_KEY' : '';
		throw new Error(`Pi provider requires VANTAGE_PI_API_KEY${fallback}.`);
	}
	return apiKey;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
	return values.find((value) => value !== undefined && value.trim() !== '');
}

async function writeOptionalTrace(filePath: string | undefined, content: string): Promise<void> {
	if (!filePath) {
		return;
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
```

If TypeScript reports that `completeSimple` does not accept `timeoutMs` or `signal`, keep the public `PiCompleteOptions` contract and move timeout/abort handling into `PiAiRuntime` with an `AbortController` wrapper. Do not remove timeout fields from `PiProvider`.

- [ ] **Step 2: Run tests**

Run:

```bash
npm run test:backend
```

Expected: Pi provider tests pass or fail only on exact `@earendil-works/pi-ai` type signatures. If type signatures fail, adjust `PiAiRuntime` only; do not change provider tests unless the observed package return shape requires updating `extractPiText`.

## Task 4: Wire Pi Into Provider Factory

**Files:**
- Modify: `server/src/neovim/provider-factory.ts`
- Modify: `server/src/neovim/provider-factory.test.ts`

- [ ] **Step 1: Add failing factory tests**

Append these tests to `server/src/neovim/provider-factory.test.ts`:

```typescript
test('createProviderFromEnv selects Pi provider with defaults', () => {
	const provider = createProviderFromEnv({
		VANTAGE_PROVIDER: 'pi',
		VANTAGE_PI_API_KEY: 'sk-test',
	});

	assert.ok(provider instanceof PiProvider);
	assert.equal(provider.provider, 'openai');
	assert.equal(provider.model, 'gpt-4o-mini');
	assert.equal(provider.timeoutMs, 300_000);
	assert.equal(provider.annotationTimeoutMs, 30_000);
});

test('createProviderFromEnv passes Pi overrides', () => {
	const provider = createProviderFromEnv({
		VANTAGE_PROVIDER: 'pi',
		VANTAGE_PI_PROVIDER: 'anthropic',
		VANTAGE_PI_MODEL: 'claude-sonnet-test',
		VANTAGE_PI_API_KEY: 'sk-test',
		VANTAGE_PI_TIMEOUT_MS: '900000',
		VANTAGE_PI_ANNOTATION_TIMEOUT_MS: '45000',
		VANTAGE_PI_TRACE_PROMPT_PATH: '/tmp/pi-prompt.txt',
		VANTAGE_PI_TRACE_RESPONSE_PATH: '/tmp/pi-response.txt',
	});

	assert.ok(provider instanceof PiProvider);
	assert.equal(provider.provider, 'anthropic');
	assert.equal(provider.model, 'claude-sonnet-test');
	assert.equal(provider.timeoutMs, 900_000);
	assert.equal(provider.annotationTimeoutMs, 45_000);
	assert.equal(provider.tracePromptPath, '/tmp/pi-prompt.txt');
	assert.equal(provider.traceResponsePath, '/tmp/pi-response.txt');
});
```

Add this import at the top:

```typescript
import { PiProvider } from './pi-provider';
```

Update the unknown-provider assertion to match the new provider list:

```typescript
/Unsupported provider "llama".*pi/
```

- [ ] **Step 2: Run factory tests to verify failure**

Run:

```bash
npm run test:backend
```

Expected: FAIL because `provider-factory.ts` does not import or construct `PiProvider`.

- [ ] **Step 3: Implement factory wiring**

Modify `server/src/neovim/provider-factory.ts`:

```typescript
import { PiProvider } from './pi-provider';
```

Add env fields:

```typescript
VANTAGE_PI_PROVIDER?: string;
VANTAGE_PI_MODEL?: string;
VANTAGE_PI_API_KEY?: string;
VANTAGE_PI_TIMEOUT_MS?: string;
VANTAGE_PI_ANNOTATION_TIMEOUT_MS?: string;
VANTAGE_PI_TRACE_PROMPT_PATH?: string;
VANTAGE_PI_TRACE_RESPONSE_PATH?: string;
```

Add provider branch before the final throw:

```typescript
if (providerName === 'pi') {
	return new PiProvider({
		env,
		provider: env.VANTAGE_PI_PROVIDER,
		model: env.VANTAGE_PI_MODEL,
		timeoutMs: parseOptionalPositiveInteger(env.VANTAGE_PI_TIMEOUT_MS, 'VANTAGE_PI_TIMEOUT_MS'),
		annotationTimeoutMs: parseOptionalPositiveInteger(
			env.VANTAGE_PI_ANNOTATION_TIMEOUT_MS,
			'VANTAGE_PI_ANNOTATION_TIMEOUT_MS'
		),
		tracePromptPath: env.VANTAGE_PI_TRACE_PROMPT_PATH,
		traceResponsePath: env.VANTAGE_PI_TRACE_RESPONSE_PATH,
	});
}
```

Update final error:

```typescript
throw new Error(`Unsupported provider "${providerName}". Expected "fake", "codex", "ollama", "chatgpt", or "pi".`);
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:backend
```

Expected: PASS.

## Task 5: Wire Pi Into Neovim Dev Flow

**Files:**
- Modify: `nvim/dev/init.lua`
- Modify: `nvim/tests/dev_init_spec.lua`
- Modify: `lua/vantage/commands.lua`

- [ ] **Step 1: Update dev init tests**

In `nvim/tests/dev_init_spec.lua`, include `pi` in the expected stdio condition:

```lua
vim.env.VANTAGE_DEV_PROVIDER == "codex"
	or vim.env.VANTAGE_DEV_PROVIDER == "ollama"
	or vim.env.VANTAGE_DEV_PROVIDER == "chatgpt"
	or vim.env.VANTAGE_DEV_PROVIDER == "pi"
```

- [ ] **Step 2: Run Neovim tests to verify failure**

Run:

```bash
npm run test:nvim
```

Expected: PASS, because this test is only active when the env is set. The failing coverage is added in Task 6 through `make test-dev-init-pi`.

- [ ] **Step 3: Update dev init**

In `nvim/dev/init.lua`, include `pi` in the stdio condition:

```lua
vim.env.VANTAGE_DEV_PROVIDER == "codex"
	or vim.env.VANTAGE_DEV_PROVIDER == "ollama"
	or vim.env.VANTAGE_DEV_PROVIDER == "chatgpt"
	or vim.env.VANTAGE_DEV_PROVIDER == "pi"
```

- [ ] **Step 4: Update annotation provider status**

In `lua/vantage/commands.lua`, extend `annotation_provider()`:

```lua
elseif name == "pi" then
	local pi_provider = vim.env.VANTAGE_PI_PROVIDER or "openai"
	local pi_model = vim.env.VANTAGE_PI_MODEL or "gpt-4o-mini"
	model = pi_provider .. "/" .. pi_model
	trace = vim.env.VANTAGE_PI_TRACE_RESPONSE_PATH
```

- [ ] **Step 5: Run Neovim tests**

Run:

```bash
npm run test:nvim
```

Expected: PASS.

## Task 6: Add Make Targets

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add variables**

Near existing provider variables:

```make
PI_PROVIDER ?= openai
PI_MODEL ?= gpt-4o-mini
PI_TIMEOUT_MS ?= 300000
PI_ANNOTATION_TIMEOUT_MS ?= 30000
```

- [ ] **Step 2: Update `.PHONY`**

Add:

```make
run-pi test-dev-init-pi
```

- [ ] **Step 3: Add `run-pi`**

Add after `run-chatgpt`:

```make
run-pi: trace-dirs compile
	$(DEV_ENV) VANTAGE_DEV_PROVIDER=pi VANTAGE_PROVIDER=pi VANTAGE_PI_PROVIDER="$(PI_PROVIDER)" VANTAGE_PI_MODEL="$(PI_MODEL)" VANTAGE_PI_API_KEY="$(PI_API_KEY)" VANTAGE_PI_TIMEOUT_MS="$(PI_TIMEOUT_MS)" VANTAGE_PI_ANNOTATION_TIMEOUT_MS="$(PI_ANNOTATION_TIMEOUT_MS)" VANTAGE_PI_TRACE_PROMPT_PATH="$(TRACE_DIR)/pi-prompt.txt" VANTAGE_PI_TRACE_RESPONSE_PATH="$(TRACE_DIR)/pi-response.txt" $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"
```

- [ ] **Step 4: Add dev-init check**

Add after `test-dev-init-chatgpt`:

```make
test-dev-init-pi: dev-dirs compile
	$(DEV_ENV) VANTAGE_DEV_PROVIDER=pi $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa
```

- [ ] **Step 5: Include it in `test`**

Update the `test` target so it runs `test-dev-init-pi` with the other dev init checks.

- [ ] **Step 6: Run Makefile checks**

Run:

```bash
make test-dev-init-pi
make test
```

Expected: both pass.

## Task 7: Document Pi Provider

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Pi run instructions**

Add this section after ChatGPT provider instructions:

```markdown
Open Neovim with the Pi AI provider:

```bash
OPENAI_API_KEY=... make run-pi
```

`make run-pi` uses `@earendil-works/pi-ai` as the model abstraction layer. It defaults to `openai/gpt-4o-mini`, a five-minute general request timeout, and a 30-second annotation timeout. Override them when needed:

```bash
make run-pi PI_PROVIDER=openai PI_MODEL=gpt-4o-mini PI_ANNOTATION_TIMEOUT_MS=45000
```

Manual Pi runs write `.nvim-dev/trace/pi-prompt.txt` when a request starts and `.nvim-dev/trace/pi-response.txt` when the provider returns.
```

- [ ] **Step 2: Run docs grep**

Run:

```bash
rg -n "run-pi|VANTAGE_PI|PI_MODEL|pi-response" README.md Makefile server/src/neovim nvim lua
```

Expected: Pi docs, Makefile variables, provider factory env fields, and status trace wiring are present.

## Task 8: Final Verification

**Files:**
- All files touched by previous tasks.

- [ ] **Step 1: Run backend tests**

Run:

```bash
npm run test:backend
```

Expected: PASS with all backend tests.

- [ ] **Step 2: Run Neovim tests**

Run:

```bash
npm run test:nvim
```

Expected: PASS.

- [ ] **Step 3: Run full Makefile test**

Run:

```bash
make test
```

Expected: PASS, including `test-dev-init-pi`.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Review project references**

Run:

```bash
rg -n "VANTAGE_PI|run-pi|PiProvider|pi-provider|@earendil-works/pi-ai" .
```

Expected: references are limited to provider source, tests, Makefile, README, package files, and this plan.

## Out Of Scope

- Do not use `@earendil-works/pi-coding-agent` or `createAgentSession`.
- Do not add agent tools, persistent sessions, file mutation, or shell access.
- Do not make Pi the default Vantage provider.
- Do not remove existing Codex, Ollama, ChatGPT, or fake providers.
