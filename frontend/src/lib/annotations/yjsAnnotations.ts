import * as YJs from 'yjs';
import { LineEdit, trackAnnotations } from './lineTracking';


export interface CommentReply {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface AnnotationThread {
  id: string;
  /** 0-based line number in the document. */
  line: number;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  replies: CommentReply[];
  resolved: boolean;
  resolvedAt?: number;
}

export const ANNOTATIONS_MAP_NAME = 'annotations';

export type AnnotationsMap = YJs.Map<YJs.Map<unknown>>;

export function getAnnotationsMap(doc: YJs.Doc): AnnotationsMap {
  return doc.getMap<YJs.Map<unknown>>(ANNOTATIONS_MAP_NAME);
}

function toThread(id: string, map: YJs.Map<unknown>): AnnotationThread {
  const repliesMap = map.get('replies') as YJs.Array<YJs.Map<unknown>> | undefined;
  const replies: CommentReply[] = [];
  if (repliesMap) {
    repliesMap.forEach((replyMap) => {
      replies.push({
        id: String(replyMap.get('id')),
        authorId: String(replyMap.get('authorId')),
        authorName: String(replyMap.get('authorName')),
        body: String(replyMap.get('body')),
        createdAt: Number(replyMap.get('createdAt')),
      });
    });
  }
  return {
    id,
    line: Number(map.get('line')),
    authorId: String(map.get('authorId')),
    authorName: String(map.get('authorName')),
    body: String(map.get('body')),
    createdAt: Number(map.get('createdAt')),
    replies,
    resolved: Boolean(map.get('resolved')),
    resolvedAt: map.get('resolvedAt') == null ? undefined : Number(map.get('resolvedAt')),
  };
}

export function readAllThreads(doc: YJs.Doc): AnnotationThread[] {
  const map = getAnnotationsMap(doc);
  const threads: AnnotationThread[] = [];
  map.forEach((threadMap, id) => {
    threads.push(toThread(id, threadMap));
  });
  return threads.sort((a, b) => a.line - b.line || a.createdAt - b.createdAt);
}

export interface CreateThreadInput {
  line: number;
  authorId: string;
  authorName: string;
  body: string;
}

export function createThread(doc: YJs.Doc, input: CreateThreadInput): string {
  const map = getAnnotationsMap(doc);
  const id = createId();
  const thread = new YJs.Map<unknown>();
  thread.set('id', id);
  thread.set('line', Math.max(0, input.line));
  thread.set('authorId', input.authorId);
  thread.set('authorName', input.authorName);
  thread.set('body', input.body);
  thread.set('createdAt', Date.now());
  thread.set('resolved', false);
  thread.set('replies', new YJs.Array<YJs.Map<unknown>>());
  map.set(id, thread);
  return id;
}

export function addReply(
  doc: YJs.Doc,
  threadId: string,
  reply: { authorId: string; authorName: string; body: string },
): void {
  const thread = getAnnotationsMap(doc).has(threadId) ? getAnnotationsMap(doc).get(threadId) : undefined;
  if (!thread) return;
  const replies = thread.get('replies');
  if (!(replies instanceof YJs.Array)) return;
  const replyMap = new YJs.Map<unknown>();
  replyMap.set('id', createId());
  replyMap.set('authorId', reply.authorId);
  replyMap.set('authorName', reply.authorName);
  replyMap.set('body', reply.body);
  replyMap.set('createdAt', Date.now());
  replies.push([replyMap]);
}

export function resolveThread(doc: YJs.Doc, threadId: string): void {
  const thread = getAnnotationsMap(doc).has(threadId) ? getAnnotationsMap(doc).get(threadId) : undefined;
  if (!thread) return;
  thread.set('resolved', true);
  thread.set('resolvedAt', Date.now());
}

export function reopenThread(doc: YJs.Doc, threadId: string): void {
  const thread = getAnnotationsMap(doc).has(threadId) ? getAnnotationsMap(doc).get(threadId) : undefined;
  if (!thread) return;
  thread.set('resolved', false);
  thread.delete('resolvedAt');
}

export function deleteThread(doc: YJs.Doc, threadId: string): void {
  getAnnotationsMap(doc).delete(threadId);
}

/**
 * Re-anchor every thread after line edits are applied to the document.
 * Threads that fall outside the document are moved to the last valid line.
 */
export function reanchorThreads(doc: YJs.Doc, edits: LineEdit[], documentLineCount: number): void {
  const map = getAnnotationsMap(doc);
  const anchors: { id: string; line: number }[] = [];
  map.forEach((thread, id) => {
    anchors.push({ id, line: Number(thread.get('line')) });
  });
  const { updated } = trackAnnotations(anchors, edits);
  doc.transact(() => {
    for (const [id, line] of Object.entries(updated)) {
      const thread = map.get(id);
      if (!thread) continue;
      const clamped = Math.min(Math.max(0, line), Math.max(0, documentLineCount - 1));
      thread.set('line', clamped);
    }
  });
}

export function observeThreads(doc: YJs.Doc, callback: (threads: AnnotationThread[]) => void): () => void {
  const map = getAnnotationsMap(doc);
  const handler = () => callback(readAllThreads(doc));
  map.observeDeep(handler);
  handler();
  return () => map.unobserveDeep(handler);
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
