import { Text } from '@codemirror/state';

export interface LineAnchor {
  /** Stable identifier for the annotation thread. */
  id: string;
  /** 0-based line number the annotation is currently attached to. */
  line: number;
}

export interface LineTrackingResult {
  /** Map of annotation id -> updated 0-based line number. */
  updated: Record<string, number>;
  /** Annotation ids that could not be mapped (out of bounds). */
  dropped: string[];
}

/**
 * Compute the new line positions of annotations after a set of line edits.
 *
 * This is a pure function so it can be unit tested easily and reused by the
 * YJs sync layer and the Monaco glyph manager. Edits are applied in order.
 *
 * Each edit describes a change in the document as a range of lines that were
 * replaced. The `from` and `to` are 0-based line indices in the document before
 * the edit is applied. `from === to` represents an insertion at that line, and
 * `to > from` represents a deletion or replacement.
 */
export interface LineEdit {
  /** 0-based index of the first line replaced (inclusive). */
  from: number;
  /** 0-based index of the line after the last line replaced (exclusive). */
  to: number;
  /** Number of lines inserted in place of the replaced range. */
  inserted: number;
}

/**
 * Adjust a single line index given a list of edits.
 */
export function adjustLine(line: number, edits: LineEdit[]): number {
  let result = line;
  for (const edit of edits) {
    const delta = edit.inserted - (edit.to - edit.from);
    if (result < edit.from) {
      // Annotation is above the edit range; nothing changes.
      continue;
    }
    if (result >= edit.to) {
      // Annotation is below the edit range; shift by the delta.
      result += delta;
      continue;
    }
    // Annotation is inside the replaced range. Attach it to the first line
    // of the replacement so the thread does not detach.
    result = edit.from;
  }
  return Math.max(0, result);
}

/**
 * Recompute the position of every annotation after a batch of line edits.
 */
export function trackAnnotations(
  annotations: LineAnchor[],
  edits: LineEdit[],
  documentLineCount?: number,
): LineTrackingResult {
  const updated: Record<string, number> = {};
  const dropped: string[] = [];
  for (const annotation of annotations) {
    const next = adjustLine(annotation.line, edits);
    if (typeof documentLineCount === 'number' && next >= documentLineCount) {
      dropped.push(annotation.id);
      continue;
    }
    updated[annotation.id] = next;
  }
  return { updated, dropped };
}

/**
 * Derive line edits from a pair of text documents. Used by the YJs sync layer
 * when a remote peer sends a full document snapshot instead of fine-grained edits.
 */
export function diffLineEdits(before: string, after: string): LineEdit[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const edits: LineEdit[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  let i = 0;
  while (i < max) {
    if (beforeLines[i] === afterLines[i]) {
      i += 1;
      continue;
    }
    // Find the next common line to bound the edit range.
    let b = i;
    let a = i;
    while (b < beforeLines.length && a < afterLines.length && beforeLines[b] !== afterLines[a]) {
      b += 1;
      a += 1;
    }
    edits.push({ from: i, to: b, inserted: a - i });
    i = Math.max(b, a);
  }
  return edits;
}

/**
 * Convenience helper to convert a Codemirror transaction into line edits.
 * Falls back to a full-document diff when the transaction changes are not
 * available.
 */
export function editsFromTransaction(transaction: { state: Text }, previous: string): LineEdit[] {
  const next = transaction.state.doc.toString();
  return diffLineEdits(previous, next);
}
