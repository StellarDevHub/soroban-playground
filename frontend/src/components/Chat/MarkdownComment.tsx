import React, { useMemo } from 'react';

export interface MarkdownCommentProps {
  content: string;
  /** Map of user id -> display name for @termention rendering. */
  mentions?: Record<string, string>;
}

interface RenderedNode {
  kind: 'text' | 'code' | 'list' | 'heading';
  content?: string;
  language?: string;
  items?: string[];
  level?: number;
}

function parseMarkdown(source: string): RenderedNode[] {
  const nodes: RenderedNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```([\w+-]*)/.exec(line);
    if (fence) {
      const language = fence[1] || 'text';
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1;
      nodes.push({ kind: 'code', content: buffer.join('\n'), language });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      nodes.push({ kind: 'heading', level: heading[1].length, content: heading[2] });
      i += 1;
      continue;
    }
    const listItem = /^\s*(-|\*|\d+\.)\s+(.+)$/.exec(line);
    if (listItem) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*(-|\*|\d+\.)\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[2]);
        i += 1;
      }
      nodes.push({ kind: 'list', items });
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    nodes.push({ kind: 'text', content: paragraph.join(' ') });
  }
  return nodes;
}

function renderInline(text: string, mentions?: Record<string, string>): React.ReactNode {
  const parts = text.split(/(@[\w.-]+)/g);
  return parts.map((part, index) => {
    if (part.startsWith('@')) {
      const handle = part.slice(1);
      const label = mentions?.[handle] ?? handle;
      return (
        <span key={`${part}-${index}`} className="mention" data-mention={handle}>
          {`@${label}`}
        </span>
      );
    }
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

export const MarkdownComment: React.FC<MarkdownCommentProps> = ({ content, mentions }) => {
  const nodes = useMemo(() => parseMarkdown(content), [content]);
  return (
    <div className="markdown-comment">
      {nodes.map((node, index) => {
        if (node.kind === 'code') {
          return (
            <pre key={index} className={`code-block language-${node.language}`}>
              <code data-language={node.language}>{node.content}</code>
            </pre>
          );
        }
        if (node.kind === 'heading') {
          const Tag = `H${node.level}` as keyof JSX.IntrinsicElements;
          return <Tag key={index}>{renderInline(node.content ?? '', mentions)}</Tag>;
        }
        if (node.kind === 'list') {
          return (
            <ul key={index}>
              {node.items?.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, mentions)}</li>)}
            </ul>
          );
        }
        return <p key={index}>{renderInline(node.content ?? '', mentions)}</p>;
      })}
    </div>
  );
};

export default MarkdownComment;
