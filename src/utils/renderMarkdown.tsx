import React from 'react';
import { Box, Text } from 'ink';

// ---------------------------------------------------------------------------
// Inline parser — handles **bold**, `code`, *italic*
// ---------------------------------------------------------------------------

const INLINE_RE = /\*\*([^*\n]+?)\*\*|`([^`\n]+?)`|\*([^*\n]+?)\*/g;

interface InlinePart {
  type: 'text' | 'bold' | 'code' | 'italic';
  content: string;
}

function parseInline(raw: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(raw)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', content: raw.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      parts.push({ type: 'bold', content: m[1] });
    } else if (m[2] !== undefined) {
      parts.push({ type: 'code', content: m[2] });
    } else if (m[3] !== undefined) {
      parts.push({ type: 'italic', content: m[3] });
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    parts.push({ type: 'text', content: raw.slice(last) });
  }
  return parts;
}

function InlineText({ raw }: { raw: string }): React.ReactElement {
  const parts = parseInline(raw);
  if (parts.length === 0) return <Text>{''}</Text>;
  return (
    <Text wrap="wrap">
      {parts.map((p, i) => {
        if (p.type === 'bold') return <Text key={i} bold>{p.content}</Text>;
        if (p.type === 'code') return <Text key={i} color="magenta">{p.content}</Text>;
        if (p.type === 'italic') return <Text key={i} italic>{p.content}</Text>;
        return <Text key={i}>{p.content}</Text>;
      })}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Block-level renderer
// ---------------------------------------------------------------------------

export function MarkdownText({ content }: { content: string }): React.ReactElement {
  const lines = content.split('\n');
  const elements: React.ReactElement[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      elements.push(
        <Box key={key++} flexDirection="column">
          {codeLines.map((cl, ci) => (
            <Text key={ci} color="green" dimColor>{cl}</Text>
          ))}
        </Box>
      );
      i++; // skip closing ```
      continue;
    }

    // H1/H2
    if (/^#{1,2} /.test(line)) {
      const text = line.replace(/^#{1,2} /, '');
      elements.push(
        <Text key={key++} bold color="cyan">{text}</Text>
      );
      i++;
      continue;
    }

    // H3
    if (/^### /.test(line)) {
      const text = line.replace(/^### /, '');
      elements.push(
        <Text key={key++} bold color="blue">{text}</Text>
      );
      i++;
      continue;
    }

    // Unordered bullet
    if (/^[-*+] /.test(line)) {
      const text = line.replace(/^[-*+] /, '');
      elements.push(
        <Box key={key++} flexDirection="row">
          <Text color="cyan">{'• '}</Text>
          <InlineText raw={text} />
        </Box>
      );
      i++;
      continue;
    }

    // Numbered list
    const numMatch = /^(\d+)\. (.*)$/.exec(line);
    if (numMatch) {
      elements.push(
        <Box key={key++} flexDirection="row">
          <Text color="cyan">{numMatch[1]}{'. '}</Text>
          <InlineText raw={numMatch[2]!} />
        </Box>
      );
      i++;
      continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      elements.push(<Text key={key++}>{' '}</Text>);
      i++;
      continue;
    }

    // Regular line
    elements.push(
      <Box key={key++}>
        <InlineText raw={line} />
      </Box>
    );
    i++;
  }

  return (
    <Box flexDirection="column">
      {elements}
    </Box>
  );
}
