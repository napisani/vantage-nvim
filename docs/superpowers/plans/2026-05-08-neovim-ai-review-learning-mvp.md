# Neovim AI Review Learning MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working Neovim-native command loop with a TypeScript backend, fake provider responses, floating markdown output, and scoped virtual-text annotations.

**Architecture:** The Neovim Lua plugin owns commands, selections, floats, extmarks, and active lens state. A TypeScript backend under `server/src/neovim` owns request contracts, fake provider behavior, and a newline-delimited stdio JSON server. This first slice deliberately avoids real model calls and deep git analysis so the UX and protocol can be exercised quickly.

**Tech Stack:** Neovim Lua, Node.js/TypeScript, Node `node:test`, newline-delimited JSON over stdio, existing `npm run compile` TypeScript build.

---

## Scope

This plan implements Milestone 1 from the design spec: an end-to-end loop using fake provider responses. It does not add real OpenAI/opencode/local provider calls, docs/RAG retrieval, or full git hunk analysis. Those are separate plans after this slice proves the Neovim ergonomics.

## File Structure

- Create `server/src/neovim/protocol.ts`: shared backend request/response types and runtime request validation.
- Create `server/src/neovim/fake-provider.ts`: deterministic fake explanation, annotation, and review responses.
- Create `server/src/neovim/handlers.ts`: method dispatch from validated requests to provider responses.
- Create `server/src/neovim/stdio-server.ts`: newline-delimited JSON stdin/stdout server for the plugin.
- Create `server/src/neovim/*.test.ts`: backend unit and stdio smoke tests using Node `node:test`.
- Create `lua/learn/state.lua`: active lens and configuration state.
- Create `lua/learn/context.lua`: buffer, visible range, current line, and selection context capture.
- Create `lua/learn/backend.lua`: fake-mode and stdio backend client for Neovim.
- Create `lua/learn/ui.lua`: floating markdown window rendering.
- Create `lua/learn/annotations.lua`: extmark namespace and annotation rendering/clearing.
- Create `lua/learn/commands.lua`: user-facing command implementations.
- Create `lua/learn/init.lua`: setup entrypoint.
- Create `plugin/learn.lua`: auto-register default commands when plugin loads.
- Create `nvim/tests/minimal_init.lua`: headless Neovim test bootstrap.
- Create `nvim/tests/learn_spec.lua`: small test runner and plugin behavior tests.
- Modify `package.json`: add backend, Neovim, and MVP test scripts.
- Modify `README.md`: replace sample LSP usage with the new Neovim-first development loop.

## Request Contract

Use newline-delimited JSON. Each request is one JSON object with:

```json
{"id":"1","method":"explainSelection","params":{"filePath":"/repo/lib/foo.ex","language":"elixir","text":"defmodule Foo do\nend","cursor":{"line":0,"character":0},"range":{"startLine":0,"startCharacter":0,"endLine":1,"endCharacter":3},"selectedText":"defmodule Foo do\nend","lens":{"mode":"learning","text":"I am learning Elixir syntax"}}}
```

Each response is one JSON object with the same `id`:

```json
{"id":"1","ok":true,"result":{"kind":"explanation","markdown":"## Explanation\n\nFake provider response for **elixir**.","lens":"learning: I am learning Elixir syntax","contextSummary":"elixir /repo/lib/foo.ex"}}
```

## Task 1: Backend Protocol, Fake Provider, And Dispatch

**Files:**
- Create: `server/src/neovim/protocol.ts`
- Create: `server/src/neovim/fake-provider.ts`
- Create: `server/src/neovim/handlers.ts`
- Create: `server/src/neovim/protocol.test.ts`
- Create: `server/src/neovim/handlers.test.ts`

- [ ] **Step 1: Write failing backend protocol and handler tests**

Create `server/src/neovim/protocol.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackendRequest } from './protocol';

test('parseBackendRequest accepts an explainSelection request', () => {
	const parsed = parseBackendRequest({
		id: 'req-1',
		method: 'explainSelection',
		params: {
			filePath: '/repo/example.ex',
			language: 'elixir',
			text: 'defmodule Example do\nend',
			cursor: { line: 0, character: 0 },
			selectedText: 'defmodule Example do\nend',
			lens: { mode: 'learning', text: 'I am learning Elixir syntax' },
		},
	});

	assert.equal(parsed.id, 'req-1');
	assert.equal(parsed.method, 'explainSelection');
	assert.equal(parsed.params.language, 'elixir');
	assert.equal(parsed.params.lens?.mode, 'learning');
});

test('parseBackendRequest rejects a request without an id', () => {
	assert.throws(
		() => parseBackendRequest({ method: 'explainSelection', params: {} }),
		/request id must be a non-empty string/
	);
});

test('parseBackendRequest rejects an unknown method', () => {
	assert.throws(
		() => parseBackendRequest({ id: 'req-1', method: 'unknown', params: {} }),
		/unsupported method/
	);
});
```

Create `server/src/neovim/handlers.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBackendRequest } from './handlers';

test('handleBackendRequest returns a fake explanation', async () => {
	const response = await handleBackendRequest({
		id: 'req-1',
		method: 'explainSelection',
		params: {
			filePath: '/repo/example.ex',
			language: 'elixir',
			text: 'defmodule Example do\nend',
			cursor: { line: 0, character: 0 },
			selectedText: 'defmodule Example do\nend',
			lens: { mode: 'learning', text: 'I am learning Elixir syntax' },
		},
	});

	assert.equal(response.id, 'req-1');
	assert.ok(response.ok);
	assert.equal(response.result.kind, 'explanation');
	assert.match(response.result.markdown, /Fake provider/);
	assert.match(response.result.markdown, /Elixir/);
});

test('handleBackendRequest returns capped annotations', async () => {
	const response = await handleBackendRequest({
		id: 'req-2',
		method: 'annotateRange',
		params: {
			filePath: '/repo/example.ts',
			language: 'typescript',
			text: 'const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;',
			cursor: { line: 0, character: 0 },
			visibleRange: { startLine: 0, startCharacter: 0, endLine: 3, endCharacter: 15 },
			scopeText: 'const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;',
			lens: { mode: 'review', text: 'Check naming clarity' },
		},
	});

	assert.ok(response.ok);
	assert.equal(response.result.kind, 'annotations');
	assert.equal(response.result.annotations.length, 3);
	assert.equal(response.result.annotations[0].range.startLine, 0);
});
```

- [ ] **Step 2: Run backend tests to verify they fail**

Run:

```bash
npm run compile --prefix server && node --test server/out/neovim/protocol.test.js server/out/neovim/handlers.test.js
```

Expected: TypeScript compile fails because `server/src/neovim/protocol.ts` and `server/src/neovim/handlers.ts` do not exist.

- [ ] **Step 3: Implement protocol types and validation**

Create `server/src/neovim/protocol.ts`:

```ts
export type LensMode = 'learning' | 'review' | 'general';

export interface Lens {
	mode: LensMode;
	text: string;
}

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

export interface GitContext {
	repoRoot?: string;
	branch?: string;
	currentHunk?: string;
	diffSummary?: string;
	touchedFiles?: string[];
}

export interface BaseRequestParams {
	filePath: string;
	language: string;
	text: string;
	cursor: Position;
	range?: Range;
	visibleRange?: Range;
	lens?: Lens;
	override?: string;
	git?: GitContext;
}

export interface ExplainSelectionParams extends BaseRequestParams {
	selectedText: string;
}

export interface AnnotateRangeParams extends BaseRequestParams {
	scopeText: string;
}

export interface ReviewCurrentHunkParams extends BaseRequestParams {
	hunkText: string;
}

export type BackendMethod = 'explainSelection' | 'annotateRange' | 'reviewCurrentHunk';

export type BackendRequest =
	| { id: string; method: 'explainSelection'; params: ExplainSelectionParams }
	| { id: string; method: 'annotateRange'; params: AnnotateRangeParams }
	| { id: string; method: 'reviewCurrentHunk'; params: ReviewCurrentHunkParams };

export interface ExplanationResult {
	kind: 'explanation';
	markdown: string;
	lens: string;
	contextSummary: string;
}

export interface Annotation {
	range: Range;
	text: string;
	category: 'syntax' | 'semantics' | 'review' | 'context';
	severity: 'info' | 'warning';
	detailMarkdown?: string;
}

export interface AnnotationResult {
	kind: 'annotations';
	annotations: Annotation[];
	lens: string;
	contextSummary: string;
	requestVersion: string;
}

export interface ReviewFinding {
	range?: Range;
	title: string;
	explanation: string;
	confidence: 'low' | 'medium' | 'high';
	category: string;
}

export interface ReviewResult {
	kind: 'review';
	markdown: string;
	findings: ReviewFinding[];
	lens: string;
	contextSummary: string;
}

export type BackendResult = ExplanationResult | AnnotationResult | ReviewResult;

export type BackendResponse =
	| { id: string; ok: true; result: BackendResult }
	| { id: string; ok: false; error: { message: string; code: string } };

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const assertString = (value: unknown, name: string): string => {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${name} must be a non-empty string`);
	}
	return value;
};

const assertNumber = (value: unknown, name: string): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${name} must be a finite number`);
	}
	return value;
};

const parsePosition = (value: unknown, name: string): Position => {
	if (!isRecord(value)) {
		throw new Error(`${name} must be an object`);
	}
	return {
		line: assertNumber(value.line, `${name}.line`),
		character: assertNumber(value.character, `${name}.character`),
	};
};

const parseRange = (value: unknown, name: string): Range => {
	if (!isRecord(value)) {
		throw new Error(`${name} must be an object`);
	}
	return {
		startLine: assertNumber(value.startLine, `${name}.startLine`),
		startCharacter: assertNumber(value.startCharacter, `${name}.startCharacter`),
		endLine: assertNumber(value.endLine, `${name}.endLine`),
		endCharacter: assertNumber(value.endCharacter, `${name}.endCharacter`),
	};
};

const parseLens = (value: unknown): Lens | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		throw new Error('lens must be an object');
	}
	const mode = assertString(value.mode, 'lens.mode');
	if (mode !== 'learning' && mode !== 'review' && mode !== 'general') {
		throw new Error('lens.mode must be learning, review, or general');
	}
	return {
		mode,
		text: assertString(value.text, 'lens.text'),
	};
};

const parseGitContext = (value: unknown): GitContext | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		throw new Error('git must be an object');
	}
	const touchedFiles = value.touchedFiles;
	if (touchedFiles !== undefined && (!Array.isArray(touchedFiles) || touchedFiles.some((item) => typeof item !== 'string'))) {
		throw new Error('git.touchedFiles must be an array of strings');
	}
	const parsedTouchedFiles = Array.isArray(touchedFiles) ? touchedFiles as string[] : undefined;
	return {
		repoRoot: typeof value.repoRoot === 'string' ? value.repoRoot : undefined,
		branch: typeof value.branch === 'string' ? value.branch : undefined,
		currentHunk: typeof value.currentHunk === 'string' ? value.currentHunk : undefined,
		diffSummary: typeof value.diffSummary === 'string' ? value.diffSummary : undefined,
		touchedFiles: parsedTouchedFiles,
	};
};

const parseBaseParams = (value: unknown): BaseRequestParams => {
	if (!isRecord(value)) {
		throw new Error('params must be an object');
	}
	return {
		filePath: assertString(value.filePath, 'params.filePath'),
		language: assertString(value.language, 'params.language'),
		text: assertString(value.text, 'params.text'),
		cursor: parsePosition(value.cursor, 'params.cursor'),
		range: value.range === undefined ? undefined : parseRange(value.range, 'params.range'),
		visibleRange: value.visibleRange === undefined ? undefined : parseRange(value.visibleRange, 'params.visibleRange'),
		lens: parseLens(value.lens),
		override: typeof value.override === 'string' ? value.override : undefined,
		git: parseGitContext(value.git),
	};
};

export const parseBackendRequest = (value: unknown): BackendRequest => {
	if (!isRecord(value)) {
		throw new Error('request must be an object');
	}

	const id = assertString(value.id, 'request id');
	const method = assertString(value.method, 'method');
	const base = parseBaseParams(value.params);

	if (method === 'explainSelection') {
		if (!isRecord(value.params)) {
			throw new Error('params must be an object');
		}
		return {
			id,
			method,
			params: {
				...base,
				selectedText: assertString(value.params.selectedText, 'params.selectedText'),
			},
		};
	}

	if (method === 'annotateRange') {
		if (!isRecord(value.params)) {
			throw new Error('params must be an object');
		}
		return {
			id,
			method,
			params: {
				...base,
				scopeText: assertString(value.params.scopeText, 'params.scopeText'),
			},
		};
	}

	if (method === 'reviewCurrentHunk') {
		if (!isRecord(value.params)) {
			throw new Error('params must be an object');
		}
		return {
			id,
			method,
			params: {
				...base,
				hunkText: assertString(value.params.hunkText, 'params.hunkText'),
			},
		};
	}

	throw new Error(`unsupported method: ${method}`);
};
```

- [ ] **Step 4: Implement fake provider and handlers**

Create `server/src/neovim/fake-provider.ts`:

```ts
import type {
	Annotation,
	AnnotationResult,
	ExplainSelectionParams,
	ExplanationResult,
	Range,
	ReviewCurrentHunkParams,
	ReviewFinding,
	ReviewResult,
	AnnotateRangeParams,
	BaseRequestParams,
} from './protocol';

const lensLabel = (params: BaseRequestParams): string => {
	if (!params.lens) {
		return 'none';
	}
	return `${params.lens.mode}: ${params.lens.text}`;
};

const contextSummary = (params: BaseRequestParams): string => {
	return `${params.language} ${params.filePath}`;
};

const firstWords = (text: string, maxWords: number): string => {
	return text
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.slice(0, maxWords)
		.join(' ');
};

export class FakeProvider {
	explainSelection(params: ExplainSelectionParams): ExplanationResult {
		const preview = firstWords(params.selectedText, 12);
		return {
			kind: 'explanation',
			markdown: [
				'## Explanation',
				'',
				`Fake provider response for **${params.language}**.`,
				'',
				`Lens: ${lensLabel(params)}`,
				'',
				`Selected code starts with: \`${preview}\``,
				'',
				'This verifies the Neovim command, backend protocol, and floating markdown path before real model calls are introduced.',
			].join('\n'),
			lens: lensLabel(params),
			contextSummary: contextSummary(params),
		};
	}

	annotateRange(params: AnnotateRangeParams): AnnotationResult {
		const startLine = params.visibleRange?.startLine ?? params.range?.startLine ?? 0;
		const annotations: Annotation[] = [];
		const lines = params.scopeText.split(/\r?\n/);

		for (let index = 0; index < lines.length && annotations.length < 3; index++) {
			const line = lines[index];
			if (line.trim().length === 0) {
				continue;
			}
			const range: Range = {
				startLine: startLine + index,
				startCharacter: 0,
				endLine: startLine + index,
				endCharacter: Math.max(line.length, 1),
			};
			annotations.push({
				range,
				text: `Learn: ${firstWords(line, 5)}`,
				category: params.lens?.mode === 'review' ? 'review' : 'semantics',
				severity: 'info',
				detailMarkdown: [
					'## Annotation detail',
					'',
					`Lens: ${lensLabel(params)}`,
					'',
					`Line: \`${line.trim()}\``,
				].join('\n'),
			});
		}

		return {
			kind: 'annotations',
			annotations,
			lens: lensLabel(params),
			contextSummary: contextSummary(params),
			requestVersion: `${params.filePath}:${startLine}:${annotations.length}`,
		};
	}

	reviewCurrentHunk(params: ReviewCurrentHunkParams): ReviewResult {
		const finding: ReviewFinding = {
			title: 'Fake review finding',
			explanation: `The fake provider reviewed ${params.hunkText.split(/\r?\n/).length} hunk line(s) using lens "${lensLabel(params)}".`,
			confidence: 'medium',
			category: params.lens?.mode === 'review' ? 'review' : 'context',
		};

		return {
			kind: 'review',
			markdown: [
				'## Review',
				'',
				'Fake provider response.',
				'',
				`- Lens: ${lensLabel(params)}`,
				`- Hunk lines: ${params.hunkText.split(/\r?\n/).length}`,
			].join('\n'),
			findings: [finding],
			lens: lensLabel(params),
			contextSummary: contextSummary(params),
		};
	}
}
```

Create `server/src/neovim/handlers.ts`:

```ts
import { FakeProvider } from './fake-provider';
import type { BackendRequest, BackendResponse } from './protocol';

const provider = new FakeProvider();

export const handleBackendRequest = async (request: BackendRequest): Promise<BackendResponse> => {
	try {
		if (request.method === 'explainSelection') {
			return { id: request.id, ok: true, result: provider.explainSelection(request.params) };
		}

		if (request.method === 'annotateRange') {
			return { id: request.id, ok: true, result: provider.annotateRange(request.params) };
		}

		return { id: request.id, ok: true, result: provider.reviewCurrentHunk(request.params) };
	} catch (error) {
		return {
			id: request.id,
			ok: false,
			error: {
				code: 'handler_error',
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
};
```

- [ ] **Step 5: Run backend tests to verify they pass**

Run:

```bash
npm run compile --prefix server && node --test server/out/neovim/protocol.test.js server/out/neovim/handlers.test.js
```

Expected: PASS for protocol and handler tests.

- [ ] **Step 6: Commit backend protocol slice**

```bash
git add server/src/neovim/protocol.ts server/src/neovim/fake-provider.ts server/src/neovim/handlers.ts server/src/neovim/protocol.test.ts server/src/neovim/handlers.test.ts
git commit -m "feat: add Neovim backend protocol"
```

## Task 2: Backend Stdio JSON Server

**Files:**
- Create: `server/src/neovim/stdio-server.ts`
- Create: `server/src/neovim/stdio-server.test.ts`

- [ ] **Step 1: Write failing stdio smoke test**

Create `server/src/neovim/stdio-server.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

const readJsonLine = async (stream: NodeJS.ReadableStream): Promise<Record<string, unknown>> => {
	const chunks: Buffer[] = [];
	while (true) {
		const [chunk] = await once(stream, 'data') as [Buffer];
		chunks.push(chunk);
		const text = Buffer.concat(chunks).toString('utf8');
		const newline = text.indexOf('\n');
		if (newline >= 0) {
			return JSON.parse(text.slice(0, newline)) as Record<string, unknown>;
		}
	}
};

test('stdio server responds to explainSelection', async () => {
	const serverPath = path.resolve(__dirname, 'stdio-server.js');
	const child = spawn(process.execPath, [serverPath], {
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	child.stdin.write(`${JSON.stringify({
		id: 'req-stdio',
		method: 'explainSelection',
		params: {
			filePath: '/repo/example.ex',
			language: 'elixir',
			text: 'defmodule Example do\nend',
			cursor: { line: 0, character: 0 },
			selectedText: 'defmodule Example do\nend',
			lens: { mode: 'learning', text: 'I am learning Elixir syntax' },
		},
	})}\n`);

	const response = await readJsonLine(child.stdout);
	child.kill();

	assert.equal(response.id, 'req-stdio');
	assert.equal(response.ok, true);
	assert.match(JSON.stringify(response), /Fake provider/);
});
```

- [ ] **Step 2: Run stdio test to verify it fails**

Run:

```bash
npm run compile --prefix server && node --test server/out/neovim/stdio-server.test.js
```

Expected: TypeScript compile fails because `server/src/neovim/stdio-server.ts` does not exist.

- [ ] **Step 3: Implement stdio server**

Create `server/src/neovim/stdio-server.ts`:

```ts
import readline from 'node:readline';
import { handleBackendRequest } from './handlers';
import { parseBackendRequest } from './protocol';
import type { BackendResponse } from './protocol';

const writeResponse = (response: BackendResponse): void => {
	process.stdout.write(`${JSON.stringify(response)}\n`);
};

const interfaceReader = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});

interfaceReader.on('line', (line) => {
	void (async () => {
		if (line.trim().length === 0) {
			return;
		}

		let requestId = 'unknown';
		try {
			const raw = JSON.parse(line) as unknown;
			const request = parseBackendRequest(raw);
			requestId = request.id;
			writeResponse(await handleBackendRequest(request));
		} catch (error) {
			writeResponse({
				id: requestId,
				ok: false,
				error: {
					code: 'bad_request',
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	})();
});
```

- [ ] **Step 4: Run stdio smoke test to verify it passes**

Run:

```bash
npm run compile --prefix server && node --test server/out/neovim/stdio-server.test.js
```

Expected: PASS for the stdio server smoke test.

- [ ] **Step 5: Commit stdio backend**

```bash
git add server/src/neovim/stdio-server.ts server/src/neovim/stdio-server.test.ts
git commit -m "feat: add Neovim backend stdio server"
```

## Task 3: Neovim State, Context Capture, And Headless Test Harness

**Files:**
- Create: `lua/learn/state.lua`
- Create: `lua/learn/context.lua`
- Create: `lua/learn/init.lua`
- Create: `nvim/tests/minimal_init.lua`
- Create: `nvim/tests/learn_spec.lua`

- [ ] **Step 1: Write failing Neovim tests for lens state and visible context**

Create `nvim/tests/minimal_init.lua`:

```lua
local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root)
package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. root .. "/nvim/tests/?.lua;" .. package.path
```

Create `nvim/tests/learn_spec.lua`:

```lua
local M = {}
local tests = {}

local function test(name, fn)
  table.insert(tests, { name = name, fn = fn })
end

local function eq(actual, expected)
  assert(vim.deep_equal(actual, expected), "expected " .. vim.inspect(expected) .. " but got " .. vim.inspect(actual))
end

test("state stores and clears a lens", function()
  local learn = require("learn")
  learn.setup({ backend = { mode = "fake" } })
  learn.set_lens("learning", "I am learning Lua syntax")
  eq(learn.get_lens(), { mode = "learning", text = "I am learning Lua syntax" })
  learn.clear_lens()
  eq(learn.get_lens(), nil)
end)

test("context captures visible buffer text", function()
  local learn = require("learn")
  local context = require("learn.context")
  learn.setup({ backend = { mode = "fake" } })

  vim.cmd("enew")
  vim.bo.filetype = "lua"
  vim.api.nvim_buf_set_name(0, "/tmp/learn-context.lua")
  vim.api.nvim_buf_set_lines(0, 0, -1, false, {
    "local x = 1",
    "local y = x + 1",
    "return y",
  })

  local captured = context.visible()
  eq(captured.language, "lua")
  eq(captured.filePath, "/tmp/learn-context.lua")
  eq(captured.text, "local x = 1\nlocal y = x + 1\nreturn y")
  eq(captured.visibleRange.startLine, 0)
end)

function M.run()
  local failures = {}
  for _, item in ipairs(tests) do
    local ok, err = pcall(item.fn)
    if not ok then
      table.insert(failures, item.name .. ": " .. tostring(err))
    end
  end

  if #failures > 0 then
    error(table.concat(failures, "\n"))
  end

  print("learn.nvim tests passed: " .. tostring(#tests))
end

return M
```

- [ ] **Step 2: Run Neovim tests to verify they fail**

Run:

```bash
nvim --headless -u nvim/tests/minimal_init.lua -c "lua require('learn_spec').run()" -c qa
```

Expected: FAIL because `lua/learn/init.lua` does not exist.

- [ ] **Step 3: Implement state, context, and setup entrypoint**

Create `lua/learn/state.lua`:

```lua
local M = {}

M.config = {
  backend = {
    mode = "stdio",
    command = { "node", "server/out/neovim/stdio-server.js" },
  },
}

M.lens = nil

function M.setup(config)
  M.config = vim.tbl_deep_extend("force", M.config, config or {})
end

function M.set_lens(mode, text)
  M.lens = { mode = mode, text = text }
end

function M.get_lens()
  return M.lens
end

function M.clear_lens()
  M.lens = nil
end

return M
```

Create `lua/learn/context.lua`:

```lua
local state = require("learn.state")
local M = {}

local function cursor()
  local pos = vim.api.nvim_win_get_cursor(0)
  return { line = pos[1] - 1, character = pos[2] }
end

local function range_for_lines(start_line, end_line, lines)
  local last_line = lines[#lines] or ""
  return {
    startLine = start_line,
    startCharacter = 0,
    endLine = end_line,
    endCharacter = #last_line,
  }
end

function M.visible()
  local start_line = vim.fn.line("w0") - 1
  local end_line = vim.fn.line("w$") - 1
  local lines = vim.api.nvim_buf_get_lines(0, start_line, end_line + 1, false)

  return {
    filePath = vim.api.nvim_buf_get_name(0),
    language = vim.bo.filetype ~= "" and vim.bo.filetype or "text",
    text = table.concat(lines, "\n"),
    cursor = cursor(),
    visibleRange = range_for_lines(start_line, end_line, lines),
    lens = state.get_lens(),
  }
end

function M.selection()
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")
  local start_line = start_pos[2] - 1
  local end_line = end_pos[2] - 1
  local lines = vim.api.nvim_buf_get_lines(0, start_line, end_line + 1, false)
  local selected = table.concat(lines, "\n")
  local visible = M.visible()

  visible.range = range_for_lines(start_line, end_line, lines)
  visible.selectedText = selected
  return visible
end

function M.current_line_as_selection()
  local line = vim.api.nvim_get_current_line()
  local pos = cursor()
  local visible = M.visible()

  visible.range = {
    startLine = pos.line,
    startCharacter = 0,
    endLine = pos.line,
    endCharacter = #line,
  }
  visible.selectedText = line
  return visible
end

return M
```

Create `lua/learn/init.lua`:

```lua
local state = require("learn.state")

local M = {}

function M.setup(config)
  state.setup(config)
end

function M.set_lens(mode, text)
  state.set_lens(mode, text)
end

function M.get_lens()
  return state.get_lens()
end

function M.clear_lens()
  state.clear_lens()
end

return M
```

- [ ] **Step 4: Run Neovim tests to verify they pass**

Run:

```bash
nvim --headless -u nvim/tests/minimal_init.lua -c "lua require('learn_spec').run()" -c qa
```

Expected: PASS and prints `learn.nvim tests passed: 2`.

- [ ] **Step 5: Commit Neovim state and context**

```bash
git add lua/learn/state.lua lua/learn/context.lua lua/learn/init.lua nvim/tests/minimal_init.lua nvim/tests/learn_spec.lua
git commit -m "feat: add Neovim plugin state and context"
```

## Task 4: Neovim Backend Client, Floats, Annotations, And Commands

**Files:**
- Create: `lua/learn/backend.lua`
- Create: `lua/learn/ui.lua`
- Create: `lua/learn/annotations.lua`
- Create: `lua/learn/commands.lua`
- Create: `plugin/learn.lua`
- Modify: `lua/learn/init.lua`
- Modify: `nvim/tests/learn_spec.lua`

- [ ] **Step 1: Extend Neovim tests for fake command output and annotations**

Append these tests to `nvim/tests/learn_spec.lua` before `function M.run()`:

```lua
test("explain_current_line opens a markdown float", function()
  local learn = require("learn")
  local commands = require("learn.commands")
  learn.setup({ backend = { mode = "fake" } })
  learn.set_lens("learning", "I am learning Lua syntax")

  vim.cmd("enew")
  vim.bo.filetype = "lua"
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })

  commands.explain_current_line()
  local float_buf = require("learn.ui").last_float_buf()
  assert(float_buf ~= nil, "expected a float buffer")
  local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
  assert(text:match("Explanation"), text)
  assert(text:match("Lua"), text)
end)

test("toggle_annotations renders and clears extmarks", function()
  local learn = require("learn")
  local commands = require("learn.commands")
  local annotations = require("learn.annotations")
  learn.setup({ backend = { mode = "fake" } })

  vim.cmd("enew")
  vim.bo.filetype = "lua"
  vim.api.nvim_buf_set_lines(0, 0, -1, false, {
    "local a = 1",
    "local b = a + 1",
  })

  commands.toggle_annotations()
  assert(#annotations.current_marks(0) > 0, "expected annotation marks")
  commands.toggle_annotations()
  assert(#annotations.current_marks(0) == 0, "expected annotations to clear")
end)
```

- [ ] **Step 2: Run Neovim tests to verify they fail**

Run:

```bash
nvim --headless -u nvim/tests/minimal_init.lua -c "lua require('learn_spec').run()" -c qa
```

Expected: FAIL because `learn.commands`, `learn.ui`, and `learn.annotations` do not exist.

- [ ] **Step 3: Implement backend fake mode and stdio request client**

Create `lua/learn/backend.lua`:

```lua
local state = require("learn.state")
local M = {}

local client = {
  job_id = nil,
  next_id = 0,
  pending = {},
  stdout_buffer = "",
}

local function title_case(value)
  return (value:gsub("^%l", string.upper))
end

local function fake_response(method, params)
  if method == "explainSelection" then
    return {
      kind = "explanation",
      markdown = table.concat({
        "## Explanation",
        "",
        "Fake provider response for **" .. title_case(params.language or "text") .. "**.",
        "",
        "Lens: " .. vim.inspect(params.lens),
        "",
        "Selected code: `" .. (params.selectedText or "") .. "`",
      }, "\n"),
      lens = params.lens and (params.lens.mode .. ": " .. params.lens.text) or "none",
      contextSummary = (params.language or "text") .. " " .. (params.filePath or ""),
    }
  end

  if method == "annotateRange" then
    local start_line = params.visibleRange and params.visibleRange.startLine or 0
    return {
      kind = "annotations",
      lens = params.lens and (params.lens.mode .. ": " .. params.lens.text) or "none",
      contextSummary = (params.language or "text") .. " " .. (params.filePath or ""),
      requestVersion = "fake",
      annotations = {
        {
          range = { startLine = start_line, startCharacter = 0, endLine = start_line, endCharacter = 1 },
          text = "Learn: fake annotation",
          category = "semantics",
          severity = "info",
          detailMarkdown = "## Annotation detail\n\nFake annotation.",
        },
      },
    }
  end

  return {
    kind = "review",
    markdown = "## Review\n\nFake review response.",
    findings = {
      { title = "Fake review finding", explanation = "The fake backend reviewed the hunk.", confidence = "medium", category = "review" },
    },
    lens = params.lens and (params.lens.mode .. ": " .. params.lens.text) or "none",
    contextSummary = (params.language or "text") .. " " .. (params.filePath or ""),
  }
end

local function handle_stdout(_, data)
  if not data then
    return
  end

  for _, chunk in ipairs(data) do
    if chunk ~= "" then
      client.stdout_buffer = client.stdout_buffer .. chunk
      while true do
        local newline = client.stdout_buffer:find("\n", 1, true)
        if not newline then
          break
        end
        local line = client.stdout_buffer:sub(1, newline - 1)
        client.stdout_buffer = client.stdout_buffer:sub(newline + 1)
        local ok, decoded = pcall(vim.json.decode, line)
        if ok and decoded and decoded.id and client.pending[decoded.id] then
          local callback = client.pending[decoded.id]
          client.pending[decoded.id] = nil
          vim.schedule(function()
            callback(decoded)
          end)
        end
      end
    end
  end
end

local function ensure_job()
  if client.job_id and vim.fn.jobwait({ client.job_id }, 0)[1] == -1 then
    return client.job_id
  end

  local command = state.config.backend.command
  client.job_id = vim.fn.jobstart(command, {
    stdout_buffered = false,
    stderr_buffered = false,
    on_stdout = handle_stdout,
  })

  if client.job_id <= 0 then
    error("failed to start learn backend: " .. vim.inspect(command))
  end

  return client.job_id
end

function M.request(method, params, callback)
  if state.config.backend.mode == "fake" then
    callback({ id = "fake", ok = true, result = fake_response(method, params) })
    return "fake"
  end

  client.next_id = client.next_id + 1
  local id = tostring(client.next_id)
  client.pending[id] = callback
  local payload = vim.json.encode({ id = id, method = method, params = params }) .. "\n"
  vim.fn.chansend(ensure_job(), payload)
  return id
end

function M.stop()
  if client.job_id then
    vim.fn.jobstop(client.job_id)
    client.job_id = nil
  end
  client.pending = {}
  client.stdout_buffer = ""
end

return M
```

- [ ] **Step 4: Implement UI float rendering**

Create `lua/learn/ui.lua`:

```lua
local M = {}
local last_buf = nil
local last_win = nil

function M.show_markdown(markdown)
  if last_win and vim.api.nvim_win_is_valid(last_win) then
    vim.api.nvim_win_close(last_win, true)
  end

  local lines = vim.split(markdown, "\n", { plain = true })
  local width = math.min(100, math.max(40, vim.o.columns - 8))
  local height = math.min(math.max(#lines, 4), math.max(4, vim.o.lines - 8))

  last_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[last_buf].filetype = "markdown"
  vim.api.nvim_buf_set_lines(last_buf, 0, -1, false, lines)

  last_win = vim.api.nvim_open_win(last_buf, true, {
    relative = "editor",
    row = 2,
    col = 4,
    width = width,
    height = height,
    style = "minimal",
    border = "rounded",
  })

  vim.keymap.set("n", "q", function()
    if last_win and vim.api.nvim_win_is_valid(last_win) then
      vim.api.nvim_win_close(last_win, true)
    end
  end, { buffer = last_buf, nowait = true })

  return last_buf, last_win
end

function M.last_float_buf()
  return last_buf
end

return M
```

- [ ] **Step 5: Implement annotation extmarks**

Create `lua/learn/annotations.lua`:

```lua
local M = {}
local namespace = vim.api.nvim_create_namespace("learn_annotations")
local enabled = false

function M.is_enabled()
  return enabled
end

function M.clear(bufnr)
  vim.api.nvim_buf_clear_namespace(bufnr or 0, namespace, 0, -1)
  enabled = false
end

function M.render(bufnr, annotations)
  bufnr = bufnr or 0
  vim.api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)

  for _, annotation in ipairs(annotations or {}) do
    vim.api.nvim_buf_set_extmark(bufnr, namespace, annotation.range.startLine, 0, {
      virt_text = { { annotation.text, "Comment" } },
      virt_text_pos = "eol",
    })
  end

  enabled = true
end

function M.current_marks(bufnr)
  return vim.api.nvim_buf_get_extmarks(bufnr or 0, namespace, 0, -1, {})
end

return M
```

- [ ] **Step 6: Implement commands and plugin entrypoint**

Create `lua/learn/commands.lua`:

```lua
local annotations = require("learn.annotations")
local backend = require("learn.backend")
local context = require("learn.context")
local state = require("learn.state")
local ui = require("learn.ui")

local M = {}

local function show_error(message)
  ui.show_markdown("## Learn error\n\n" .. message)
end

local function handle_markdown_response(response)
  if not response.ok then
    show_error(response.error and response.error.message or "Unknown backend error")
    return
  end
  ui.show_markdown(response.result.markdown)
end

function M.set_lens(mode, text)
  state.set_lens(mode or "general", text or "")
end

function M.clear_lens()
  state.clear_lens()
end

function M.explain_current_line()
  local params = context.current_line_as_selection()
  backend.request("explainSelection", params, handle_markdown_response)
end

function M.explain_selection()
  local params = context.selection()
  backend.request("explainSelection", params, handle_markdown_response)
end

function M.toggle_annotations()
  if annotations.is_enabled() then
    annotations.clear(0)
    return
  end

  local params = context.visible()
  params.scopeText = params.text
  backend.request("annotateRange", params, function(response)
    if not response.ok then
      show_error(response.error and response.error.message or "Unknown backend error")
      return
    end
    annotations.render(0, response.result.annotations)
  end)
end

function M.review_current_hunk()
  local params = context.visible()
  params.hunkText = params.text
  backend.request("reviewCurrentHunk", params, handle_markdown_response)
end

function M.register()
  vim.api.nvim_create_user_command("LearnSetLens", function(opts)
    local mode = opts.fargs[1] or "general"
    local words = {}
    for index = 2, #opts.fargs do
      table.insert(words, opts.fargs[index])
    end
    local text = table.concat(words, " ")
    M.set_lens(mode, text)
  end, { nargs = "+" })

  vim.api.nvim_create_user_command("LearnClearLens", function()
    M.clear_lens()
  end, {})

  vim.api.nvim_create_user_command("LearnExplainLine", function()
    M.explain_current_line()
  end, {})

  vim.api.nvim_create_user_command("LearnExplainSelection", function()
    M.explain_selection()
  end, { range = true })

  vim.api.nvim_create_user_command("LearnToggleAnnotations", function()
    M.toggle_annotations()
  end, {})

  vim.api.nvim_create_user_command("LearnReviewHunk", function()
    M.review_current_hunk()
  end, {})
end

return M
```

Update `lua/learn/init.lua`:

```lua
local commands = require("learn.commands")
local state = require("learn.state")

local M = {}

function M.setup(config)
  state.setup(config)
  commands.register()
end

function M.set_lens(mode, text)
  state.set_lens(mode, text)
end

function M.get_lens()
  return state.get_lens()
end

function M.clear_lens()
  state.clear_lens()
end

return M
```

Create `plugin/learn.lua`:

```lua
if vim.g.loaded_learn_nvim == 1 then
  return
end

vim.g.loaded_learn_nvim = 1

require("learn").setup({})
```

- [ ] **Step 7: Run Neovim tests to verify they pass**

Run:

```bash
nvim --headless -u nvim/tests/minimal_init.lua -c "lua require('learn_spec').run()" -c qa
```

Expected: PASS and prints `learn.nvim tests passed: 4`.

- [ ] **Step 8: Commit Neovim command slice**

```bash
git add lua/learn/backend.lua lua/learn/ui.lua lua/learn/annotations.lua lua/learn/commands.lua lua/learn/init.lua plugin/learn.lua nvim/tests/learn_spec.lua
git commit -m "feat: add Neovim learning commands"
```

## Task 5: Wire Real Stdio Backend Into Neovim Smoke Test And Scripts

**Files:**
- Modify: `package.json`
- Modify: `nvim/tests/learn_spec.lua`

- [ ] **Step 1: Run missing MVP script to establish the integration gap**

Run:

```bash
npm run test:mvp
```

Expected: FAIL with a missing script error because `test:mvp` has not been added to `package.json`.

- [ ] **Step 2: Add stdio integration test**

Append this test to `nvim/tests/learn_spec.lua` before `function M.run()`:

```lua
test("stdio backend opens a float through explain_current_line", function()
  local learn = require("learn")
  local commands = require("learn.commands")
  local backend = require("learn.backend")

  learn.setup({
    backend = {
      mode = "stdio",
      command = { "node", "server/out/neovim/stdio-server.js" },
    },
  })
  learn.set_lens("learning", "I am learning Lua syntax")

  vim.cmd("enew")
  vim.bo.filetype = "lua"
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { "local value = 42" })

  commands.explain_current_line()
  vim.wait(2000, function()
    local float_buf = require("learn.ui").last_float_buf()
    if not float_buf then
      return false
    end
    local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
    return text:match("Fake provider") ~= nil
  end)

  local float_buf = require("learn.ui").last_float_buf()
  assert(float_buf ~= nil, "expected stdio float buffer")
  local text = table.concat(vim.api.nvim_buf_get_lines(float_buf, 0, -1, false), "\n")
  assert(text:match("Fake provider"), text)
  backend.stop()
end)
```

- [ ] **Step 3: Add test scripts**

Modify the root `package.json` scripts block so it includes these scripts while preserving existing scripts:

```json
{
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -b",
    "watch": "tsc -b -w",
    "lint": "eslint",
    "postinstall": "cd client && npm install && cd ../server && npm install && cd ..",
    "test": "sh ./scripts/e2e.sh",
    "dev": "nodemon --watch server/src --watch client/src --exec \"npm run compile\"",
    "test:backend": "npm run compile --prefix server && node --test server/out/neovim/*.test.js",
    "test:nvim": "nvim --headless -u nvim/tests/minimal_init.lua -c \"lua require('learn_spec').run()\" -c qa",
    "test:mvp": "npm run test:backend && npm run test:nvim"
  }
}
```

- [ ] **Step 4: Run MVP test script**

Run:

```bash
npm run test:mvp
```

Expected: PASS for backend tests and Neovim tests.

- [ ] **Step 5: Commit scripts and stdio smoke test**

```bash
git add package.json nvim/tests/learn_spec.lua
git commit -m "test: add Neovim MVP smoke tests"
```

## Task 6: README Development Loop

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace sample README with Neovim-first MVP instructions**

Replace `README.md` with:

```markdown
# Learn LSP

This project is being reworked into a Neovim-first AI review and learning tool.

The v1 architecture is a Lua Neovim plugin plus a local TypeScript backend. The plugin owns commands, floating markdown windows, and virtual text annotations. The backend owns request contracts and provider behavior. The current implementation uses a deterministic fake provider so the developer experience can be tuned before real model integrations are added.

## Commands

- `:LearnSetLens learning I am learning Elixir syntax`
- `:LearnClearLens`
- `:LearnExplainLine`
- `:LearnExplainSelection`
- `:LearnToggleAnnotations`
- `:LearnReviewHunk`

## Development

Install dependencies:

```bash
npm install
```

Run the MVP tests:

```bash
npm run test:mvp
```

Run backend tests only:

```bash
npm run test:backend
```

Run headless Neovim tests only:

```bash
npm run test:nvim
```

## Manual Neovim Smoke Test

Compile the backend:

```bash
npm run compile --prefix server
```

Open this repo in Neovim with the repo root on `runtimepath`, then run:

```vim
:LearnSetLens learning I am learning Lua syntax
:LearnExplainLine
:LearnToggleAnnotations
```
```

- [ ] **Step 2: Run MVP verification**

Run:

```bash
npm run test:mvp
```

Expected: PASS for backend tests and Neovim tests.

- [ ] **Step 3: Commit README update**

```bash
git add README.md
git commit -m "docs: describe Neovim MVP workflow"
```

## Final Verification

Run:

```bash
git status --short
npm run test:mvp
```

Expected:

- `git status --short` shows no uncommitted implementation changes.
- `npm run test:mvp` passes backend and Neovim tests.

## Next Plans After This MVP

- Real provider adapter behind the same backend contract.
- Git hunk extraction and branch diff context.
- Tree-sitter current-function range detection for annotation scope.
- Annotation detail floats and review finding navigation.
