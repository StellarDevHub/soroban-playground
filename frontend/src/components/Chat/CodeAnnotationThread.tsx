import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as Monaco } from 'monaco-editor';
import type { Doc as YDoc } from 'yyjs';
import {
  AnnotationThread,
  addReply,
  createThread,
  deleteThread,
  observeThreads,
  reanchorThreads,
  reopenThread,
  resolveThread,
} from '../../lib/annotations/yjsAnnotations';
import { createGlyphManager, GlyphManager } from '../../lib/annotations/monacoGlyphs';
import { diffLineEdits } from '../../lib/annotations/lineTracking';
import { MarkdownComment } from './MarkdownComment';
import { AnnotationArchiveDrawer } from './AnnotationArchiveDrawer';

export interface CurrentUser {
  id: string;
  name: string;
}

export interface CodeAnnotationThreadProps {
  /** YJ document that holds the shared annotation map. */
  ydoc: YDoc;
  /** Monaco editor instance the glyphs are rendered into. */
  editor: Monaco.ICodeEditor | null;
  currentUser: CurrentUser;
  /** Optional map of user id -> display name for @termention rendering. */
  mentions?: Record<string, string>;
}

export const CodeAnnotationThread: React.FC<CodeAnnotationThreadProps> = ({
  ydoc,
  editor,
  currentUser,
  mentions,
}) => {
  const [threads, setThreads] = useState<AnnotationThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draftLine, setDraftLine] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const glyphManagerRef = useRef<GlyphManager | null>(null);
  const previousTextRef = useRef<string>(editor?.getModel()?.getValue() ?? '');

  // Sync threads out of the YJ map and re-render on remote changes.
  useEffect(() => {
    const unsubscribe = observeThreads(ydoc, (next) => setThreads(next));
    return unsubscribe;
  }, [ydoc]);

  // Watch document changes and re-anchor threads as lines are inserted/deleted.
  useEffect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const handler = () => {
      const next = model.getValue();
      const edits = diffLineEdits(previousTextRef.current, next);
      previousTextRef.current = next;
      if (edits.length > 0) {
        reanchorThreads(ydoc, edits, model.getLineCount());
      }
    };
    const sub = model.onDidChangeContent(handler);
    return () => sub.dispose();
  }, [editor, ydoc]);

  // Render glyphs whenever threads or the editor change.
  useEffect(() => {
    if (!editor) return;
    if (!glyphManagerRef.current) {
      glyphManagerRef.current = createGlyphManager(editor, {
        onClickThread: (id) => setActiveThreadId(id),
        onAddThread: (line) => {
          setDraftLine(line);
          setDraftBody('');
        },
      });
    }
    glyphManagerRef.current.update(threads);
  }, [editor, threads]);

  useEffect(() => {
    return () => {
      glyphManagerRef.current?.dispose();
      glyphManagerRef.current = null;
    };
  }, []);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const handleSubmitDraft = useCallback(() => {
    if (draftLine === null || draftBody.trim() === '') return;
    const id = createThread(ydoc, {
      line: draftLine,
      authorId: currentUser.id,
      authorName: currentUser.name,
      body: draftBody.trim(),
    });
    setDraftLine(null);
    setDraftBody('');
    setActiveThreadId(id);
  }, [ydoc, draftLine, draftBody, currentUser]);

  const handleSubmitReply = useCallback(() => {
    if (!activeThread || replyBody.trim() === '') return;
    addReply(ydoc, activeThread.id, {
      authorId: currentUser.id,
      authorName: currentUser.name,
      body: replyBody.trim(),
    });
    setReplyBody('');
  }, [ydoc, activeThread, replyBody, currentUser]);

  const handleResolve = useCallback(() => {
    if (!activeThread) return;
    resolveThread(ydoc, activeThread.id);
    setActiveThreadId(null);
  }, [ydoc, activeThread]);

  const handleReopen = useCallback((id: string) => {
    reopenThread(ydoc, id);
    setActiveThreadId(id);
    setArchiveOpen(false);
  }, [ydoc]);

  const handleDelete = useCallback((id: string) => {
    deleteThread(ydoc, id);
    if (activeThreadId === id) setActiveThreadId(null);
  }, [ydoc, activeThreadId]);

  return (
    <div className="code-annotation-threads">
      <div className="code-annotation-threads__toolbar">
        <button type="button" onClick={() => setArchiveOpen(true)}>
          Archive ({threads.filter((t) => t.resolved).length})
        </button>
      </div>

      {draftLine !== null && (
        <div className="code-annotation-card code-annotation-card--draft">
          <header>New thread on L<span>{draftLine + 1}</span></header>
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Leave a comment. Markdown and &mentions supported."
          />
          <div className="code-annotation-card__actions">
            <button type="button" onClick={() => setDraftLine(null)}>Cancel</button>
            <button type="button" onClick={handleSubmitDraft}>Comment</button>
          </div>
        </div>
      )}

      {activeThread && (!activeThread.resolved) ? (
        <div className="code-annotation-card">
          <header>
            <strong>{ActiveThread.authorName}</strong>
            <span>L<span>{ActiveThread.line + 1}</span></span>
          </header>
          <MarkdownComment content={activeThread.body} mentions={mentions} />
          <ul className="code-annotation-card__replies">
            {activeThread.replies.map((reply) => (
              <li key={reply.id}>
                <strong>{reply.authorName}</strong>
                <MarkdownComment content={reply.body} mentions={mentions} />
              </li>
            ))}
          </ul>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Reply..."
          />
          <div className="code-annotation-card__actions">
            <button type="button" onClick={() => setActiveThreadId(null)}>Close</button>
            <button type="button" onClick={handleSubmitReply}>Reply</button>
            <button type="button" onClick={handleResolve}>Resolve Thread</button>
          </div>
        </div>
      ) : null}

      <ul className="code-annotation-threads__list">
        {threads
          .filter((thread) => !thread.resolved)
          .map((thread) => (
            <li key={thread.id} className="code-annotation-threads__item">
              <button type="button" onClick={() => setActiveThreadId(thread.id)}>
                L<span>{thread.line + 1}</span> &middot; {thread.authorName} (<span>{thread.replies.length}</span> replies)
              </button>
            </li>
          ))}
      </ul>

      <AnnotationArchiveDrawer
        open={archiveOpen}
        threads={threads}
        onReopen={handleReopen}
        onDelete={handleDelete}
        onClose={() => setArchiveOpen(false)}
        mentions={mentions}
      />
    </div>
  );
};

export default CodeAnnotationThread;
