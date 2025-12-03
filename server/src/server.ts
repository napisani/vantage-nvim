import {
  Diagnostic,
  DiagnosticSeverity,
  createConnection,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  InitializeResult,
  Position,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createWriteStream } from "node:fs";
import OpenAI from "openai";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const connection = createConnection();
const logStream = createWriteStream("/tmp/learn-ls.log", { flags: "a" });
const log = (message: string) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
  connection.console.log(message);
};
const getFileNameFromUri = (uri: string): string => {
  try {
    const parsed = new URL(uri);
    return parsed.pathname.split("/").pop() ?? uri;
  } catch {
    return uri.split("/").pop() ?? uri;
  }
};

const documents = new Map<string, TextDocument>();

log("Starting learn-ls language server");

type CursorContext = { uri: string; fileName: string; position: Position } | null;
let lastCursorContext: CursorContext = null;

const CURRENT_CONTEXT_REQUEST = "learnls/currentContext";

const buildCurrentContext = () => {
  if (!lastCursorContext) {
    return null;
  }

  const document = documents.get(lastCursorContext.uri);
  return {
    cursor: lastCursorContext,
    content: document?.getText() ?? null,
  };
};

// Function to call ChatGPT completion API
async function getChatGPTCompletion(
  fileContent: string,
  cursorPosition: Position,
  fileName: string
): Promise<string> {
  try {
    const prompt = `You are an expert programming assistant. A developer is working on this file and is currently learning the nix programming language.
Do not provide solutions. Your goal is to TEACH the developer by providing documentation exerpts, explanations and guidance in small digestible pieces that 
are most relevant to the to the current cursor position. Do not provide suggestions for modifications. Only provide educational information that helps the developer understand the code better
especially relevant nix concepts. For example, if the cursor is on a nix derivation, briefly explain derivation concept in nix, how it works, and syntax of how it can be defined.


    
File: ${fileName}
Cursor Position: Line ${cursorPosition.line + 1}, Character ${cursorPosition.character + 1}

File Content:
${fileContent}`;

    log(`Calling ChatGPT API for ${fileName}...`);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 256,
      temperature: 0.7,
    });

    const result = completion.choices[0]?.message?.content ?? "No response from ChatGPT";
    log(`ChatGPT response: ${result}`);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error calling ChatGPT API: ${errorMessage}`);
    return `Error: ${errorMessage}`;
  }
}

// Debounce timer for ChatGPT API calls
let debounceTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_DELAY = 5000; // 5 seconds


connection.onDidOpenTextDocument((event: DidOpenTextDocumentParams) => {
  const { textDocument } = event;
  const doc = TextDocument.create(
    textDocument.uri,
    textDocument.languageId ?? "",
    textDocument.version ?? 0,
    textDocument.text ?? ""
  );
  documents.set(textDocument.uri, doc);
  log(`Document opened: ${textDocument.uri}`);
});

connection.onDidCloseTextDocument((event: DidCloseTextDocumentParams) => {
  documents.delete(event.textDocument.uri);
  connection.sendDiagnostics({ uri: event.textDocument.uri, diagnostics: [] });
  log(`Document closed: ${event.textDocument.uri}`);
});

connection.onDidChangeTextDocument((event: DidChangeTextDocumentParams) => {
  const { textDocument, contentChanges } = event;
  const current = documents.get(textDocument.uri);
  if (!current) {
    log(`Change received for unknown document ${textDocument.uri}`);
    return;
  }

  const updated = TextDocument.update(current, contentChanges, textDocument.version ?? current.version);
  documents.set(textDocument.uri, updated);

  let position: Position | null = null;

  for (const change of contentChanges) {
    if ("range" in change && change.range) {
      position = change.range.end;
    }
  }

  if (!position) {
    position = updated.positionAt(updated.getText().length);
  }

  if (!position) {
    position = { line: 0, character: 0 };
  }

  const fileName = getFileNameFromUri(textDocument.uri);

  lastCursorContext = {
    uri: textDocument.uri,
    fileName,
    position,
  };

  log(
    `Cursor updated: ${fileName} @ line ${position.line} character ${position.character}`
  );

  // Clear any existing debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    log(`Debounce timer cleared for ${fileName}`);
  }

  // Set up debounced ChatGPT API call
  debounceTimer = setTimeout(async () => {
    log(`Debounce delay elapsed, calling ChatGPT API for ${fileName}...`);
    
    const fileContent = updated.getText();
    const chatGPTResponse = await getChatGPTCompletion(fileContent, position, fileName);

    // Display the ChatGPT response as an info diagnostic at the cursor position
    const documentLines = updated.getText().split(/\r?\n/);
    const lineText = documentLines[position.line] ?? "";
    const infoDiagnostics: Diagnostic[] = [
      {
        range: {
          start: { line: position.line, character: 0 },
          end: { line: position.line, character: lineText.length },
        },
        message: chatGPTResponse,
        severity: DiagnosticSeverity.Information,
        source: "learn-ls",
      },
    ];

    connection.sendDiagnostics({
      uri: textDocument.uri,
      diagnostics: infoDiagnostics,
    });
  }, DEBOUNCE_DELAY);
});

connection.onInitialize(async(params) => {
  log(
    `Initialize request (rootUri=${params.rootUri ?? "unknown"}, locale=${params.locale ?? "unknown"})`
  );



  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      inlayHintProvider: true,
    },
    serverInfo: {
      name: "learn-ls",
      version: "0.1.0",
    },
  };

  return result;
});

connection.languages.inlayHint.on((params) => {
  log(`Inlay hint requested (uri=${params.textDocument.uri})`);

  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    log(`Inlay hint skipped: missing document for ${params.textDocument.uri}`);
    return [];
  }

  // Noop for now
  return [
    ]; 
});
connection.onRequest(CURRENT_CONTEXT_REQUEST, () => {
  const context = buildCurrentContext();
  if (!context) {
    log("Current context requested but cursor not set yet");
    return null;
  }

  log(
    `Current context requested for ${context.cursor.fileName} @ line ${context.cursor.position.line} character ${context.cursor.position.character}`
  );
  return context;
});

connection.onShutdown(() => {
  log("Shutting down language server");
  logStream.end();
});

connection.onExit(() => {
  log("Language server exited");
});

// Listen on the connection
connection.listen();
