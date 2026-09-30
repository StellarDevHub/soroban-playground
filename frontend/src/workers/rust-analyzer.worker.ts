/// <reference lib="webworker" />

import { createRustLanguageServer } from "../lib/rustLanguageServer";

const workerScope = self as DedicatedWorkerGlobalScope;
const languageServer = createRustLanguageServer((message) =>
  workerScope.postMessage(message),
);

workerScope.onmessage = (event: MessageEvent) => {
  languageServer.handleMessage(event.data);
};
