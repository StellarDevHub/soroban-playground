import type * as monaco from "monaco-editor";
import type * as Y from "yjs";
import type { MonacoBindingLike } from "./yjsProvider";

interface TextDiff {
  start: number;
  removedLength: number;
  inserted: string;
}

function diffText(before: string, after: string): TextDiff {
  let start = 0;
  const maxStart = Math.min(before.length, after.length);
  while (start < maxStart && before[start] === after[start]) start += 1;

  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  return {
    start,
    removedLength: endBefore - start,
    inserted: after.slice(start, endAfter),
  };
}

/**
 * Minimal two-way Y.Text <-> Monaco model binding. Reconnects create a fresh
 * binding while the old one is destroyed, so a socket blip cannot leave two
 * active listeners writing duplicate text into the same model.
 */
export function createMonacoYjsBinding(
  doc: Y.Doc,
  text: Y.Text,
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
): MonacoBindingLike {
  let applyingRemote = false;
  let applyingLocal = false;
  let lastValue = model.getValue();

  if (text.length === 0 && lastValue.length > 0) {
    doc.transact(() => text.insert(0, lastValue), "monaco-initial");
  } else if (text.toString() !== lastValue) {
    applyingRemote = true;
    model.setValue(text.toString());
    lastValue = text.toString();
    applyingRemote = false;
  }

  const observeText = () => {
    if (applyingLocal) return;
    const nextValue = text.toString();
    if (nextValue === lastValue) return;

    const change = diffText(lastValue, nextValue);
    applyingRemote = true;
    const start = model.getPositionAt(change.start);
    const end = model.getPositionAt(change.start + change.removedLength);
    editor.pushUndoStop();
    model.pushEditOperations(
      [],
      [
        {
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          },
          text: change.inserted,
        },
      ],
      () => null,
    );
    editor.pushUndoStop();
    lastValue = nextValue;
    applyingRemote = false;
  };

  const changeListener = model.onDidChangeContent(() => {
    if (applyingRemote) return;
    const nextValue = model.getValue();
    if (nextValue === lastValue) return;

    const change = diffText(lastValue, nextValue);
    applyingLocal = true;
    doc.transact(() => {
      text.delete(change.start, change.removedLength);
      if (change.inserted) text.insert(change.start, change.inserted);
    }, "monaco");
    lastValue = nextValue;
    applyingLocal = false;
  });

  text.observe(observeText);

  return {
    destroy() {
      text.unobserve(observeText);
      changeListener.dispose();
    },
  };
}
