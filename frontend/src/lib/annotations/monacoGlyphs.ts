import type { editor as Monaco } from 'monaco-editor';
import { Range as MonacoRange, editor as MonacoEditor } from 'monaco-editor';
import type { AnnotationThread } from './yjsAnnotations';

export const GLYPH_DECORATION_ID = 'code-annotations';

export interface GlyphHandlers {
  /** Called when the user clicks a comment glyph in the glyph margin. */
  onClickThread?: (threadId: string) => void;
  /** Called when the user clicks the add-comment glyph on a line. */
  onAddThread?: (line: number) => void;
}

export interface GlyphManager {
  update(threads: AnnotationThread[]): void;
  dispose(): void;
}

export function createGlyphManager(
  editor: Monaco.ICodeEditor,
  handlers: GlyphHandlers = {},
): GlyphManager {
  const decorationsCollection = editor.createDecorationsCollection([]);
  const disposables: Monaco.IDisposable[] = [];
  const threadById = new Map<string, AnnotationThread>();

  const clickHandler = editor.onMouseDown((event) => {
    const target = event.target;
    const element = target.element as HTMLElement | null;
    if (!element) return;
    const threadId = element.getAttribute('data-thread-id');
    if (threadId && handlers.onClickThread) {
      handlers.onClickThread(threadId);
      return;
    }
    const lineAttr = element.getAttribute('data-add-line');
    if (lineAttr != null && handlers.onAddThread) {
      handlers.onAddThread(Number(lineAttr));
    }
  });
  disposables.push(clickHandler);

  const update = (threads: AnnotationThread[]): void => {
    threadById.clear();
    const decorations: Monaco.IModelDeltaDecoration[] = [];
    const linesWithThreads = new Set<number>();
    for (const thread of threads) {
      if (thread.resolved) continue;
      threadById.set(thread.id, thread);
      linesWithThreads.add(thread.line);
      const count = 1 + thread.replies.length;
      decorations.push({
        range: new MonacoRange(thread.line + 1, 1, thread.line + 1, 1),
        options: {
          glyphMarginClassName: 'code-annotation-glyph',
          overviewRuler: {
            color: '#f59e0b',
            position: MonacoEditor.OverviewRulerLane.Left,
          },
          after: {
            content: String(count),
            className: 'code-annotation-badge',
          },
        },
      });
    }
    // Add an 'add comment' glyph on every line that has no thread already.
    const model = editor.getModel();
    if (model) {
      const lineCount = model.getLineCount();
      for (let line = 0; line < lineCount; line += 1) {
        if (linesWithThreads.has(line)) continue;
        decorations.push({
          range: new MonacoRange(line + 1, 1, line + 1, 1),
          options: {
            glyphMarginClassName: 'code-annotation-add',
          },
        });
      }
    }
    decorationsCollection.set(decorations);
  };

  // Attach thread ids to the DOM nodes after decorations are rendered.
  const domNodeChange = editor.onDidChangeModelDecorations(() => {
    const domNode = editor.getDomNode();
    if (!domNode) return;
    const nodes = domNode.querySelectorAll('.code-annotation-glyph');
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const line = el.getAttribute('data-line-number');
      if (line == null) return;
      const lineNumber = Number(line) - 1;
      for (const thread of threadById.values()) {
        if (thread.line === lineNumber) {
          el.setAttribute('data-thread-id', thread.id);
          break;
        }
      }
    });
    const addNodes = domNode.querySelectorAll('.code-annotation-add');
    addNodes.forEach((node) => {
      const el = node as HTMLElement;
      const line = el.getAttribute('data-line-number');
      if (line != null) {
        el.setAttribute('data-add-line', String(Number(line) - 1));
      }
    });
  });
  disposables.push(domNodeChange);

  return {
    update,
    dispose() {
      for (const d of disposables) {
        d.dispose();
      }
      decorationsCollection.clear();
    },
  };
}
