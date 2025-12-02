import {
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

const logStream = createWriteStream("/tmp/learn-ls.log", { flags: "a" });

const connection = createConnection();

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
});

connection.onInitialize((params) => {
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
  if (lastCursorContext){
  return [
      {
        position: lastCursorContext.position,
        label: "updated cursor hint",
        paddingLeft: true,
        paddingRight: true,
      }
    ]; 
  }

  return [
    {
      position: params.range.start,
      label: "Constant test hint",
      paddingLeft: true,
      paddingRight: true,
    },
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
