/** Markdown rendering: attachment links and the three daily-note formats. */

import type { MemoResource, NormalizedMemo } from '../types';
import {
  getCalloutType,
  getHour,
  getTimeEmoji,
  getTimePeriod,
  toDayKey,
  toTimeLabel,
} from './time';

/** Link for one attachment; empty when it was neither downloaded nor external. */
export function generateResourceLink(resource: MemoResource): string {
  if (resource.localPath) return `![[${resource.localPath}]]`;
  if (!resource.externalLink) return '';
  const prefix = resource.type.includes('image') ? '!' : '';
  const label = resource.filename || resource.name;
  return `${prefix}[${label}](${resource.externalLink})`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite server-side attachment URLs inside memo content to local vault
 * embeds. Handles `...` and `<...>` targets, plus the Memos 26 `/file/...`
 * shape and the legacy `/api/v1/attachments/...` one.
 */
export function rewriteResourceLinks(content: string, resources: MemoResource[] = []): string {
  if (!content || resources.length === 0) return content;

  let result = content;
  for (const resource of resources) {
    if (!resource.localPath) continue;
    const uid = resource.name.split('/').pop() || resource.uid;
    if (!uid) continue;

    const urlPattern = `(?:https?://[^/\\s)>]+)?/(?:file/attachments|api/v1/attachments|file)/${escapeRegExp(uid)}(?:/[^\\s)>]*)?`;

    const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(\\s*<?(${urlPattern})>?\\s*\\)`, 'g');
    result = result.replace(imagePattern, (_match, alt: string) =>
      alt ? `![[${resource.localPath}|${alt}]]` : `![[${resource.localPath}]]`,
    );

    const linkPattern = new RegExp(`(?<!!)\\[([^\\]]*)\\]\\(\\s*<?(${urlPattern})>?\\s*\\)`, 'g');
    result = result.replace(linkPattern, (_match, text: string) =>
      text ? `[[${resource.localPath}|${text}]]` : `[[${resource.localPath}]]`,
    );
  }
  return result;
}

/** Attachments that are neither embedded in the body nor external-unusable. */
export function collectTrailingResources(body: string, resources: MemoResource[]): MemoResource[] {
  return resources.filter(resource => {
    if (resource.localPath && body.includes(`![[${resource.localPath}`)) return false;
    return Boolean(resource.localPath || resource.externalLink);
  });
}

/** Append one attachment link per line, separated from the body by a blank line. */
export function appendTrailingAttachments(body: string, resources: MemoResource[]): string {
  const links = collectTrailingResources(body, resources)
    .map(resource => generateResourceLink(resource))
    .filter(Boolean);
  if (links.length === 0) return body;
  return `${body.trimEnd()}\n\n${links.join('\n')}`;
}

const LIST_INDENT = '  ';

/**
 * Indent a memo body so it stays inside its list item while keeping the
 * author's structure: blank lines survive, fenced code keeps its indentation,
 * and headings / tables / quotes get the blank line they need to render.
 */
function indentMemoBody(lines: string[]): string[] {
  const source = lines.map(line => line.replace(/[ \t]+$/, ''));
  const out: string[] = [];
  const push = (line: string) => out.push(`${LIST_INDENT}${line}`);
  const ensureBlankLine = () => {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
  };

  let i = 0;
  while (i < source.length) {
    const line = source[i];

    if (!line.trim()) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      i++;
      continue;
    }

    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      ensureBlankLine();
      push(line);
      i++;
      while (i < source.length) {
        const inner = source[i];
        if (!inner.trim()) {
          out.push('');
          i++;
          continue;
        }
        push(inner);
        i++;
        const closing = inner.match(/^\s*(`{3,}|~{3,})\s*$/);
        if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) break;
      }
      ensureBlankLine();
      continue;
    }

    if (/^\s*#{1,6}\s/.test(line)) {
      ensureBlankLine();
      push(line);
      ensureBlankLine();
      i++;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      ensureBlankLine();
      while (i < source.length && /^\s*\|/.test(source[i])) {
        push(source[i]);
        i++;
      }
      ensureBlankLine();
      continue;
    }

    if (/^\s*>/.test(line)) {
      ensureBlankLine();
      while (i < source.length && /^\s*>/.test(source[i])) {
        push(source[i]);
        i++;
      }
      ensureBlankLine();
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      ensureBlankLine();
      push(line);
      ensureBlankLine();
      i++;
      continue;
    }

    push(line);
    i++;
  }

  while (out.length > 0 && out[0] === '') out.shift();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

export interface DailyRenderOptions {
  useCalloutFormat: boolean;
  useListCalloutFormat: boolean;
  skipImages: boolean;
  /** Present only when several accounts share one daily note. */
  accountLabel?: string;
}

export interface DailyBlock {
  date: string;
  timestamp: string;
  content: string;
}

/** Tag appended to every daily-note block so synced memos can be searched and filtered. */
const MEMO_TAG = '#memos-hub';

/** Render one memo as a block for the configured daily-note format. */
export function renderDailyBlock(memo: NormalizedMemo, options: DailyRenderOptions): DailyBlock {
  const timestamp = memo.createdAt;
  if (Number.isNaN(new Date(timestamp * 1000).getTime())) {
    throw new Error(`Invalid timestamp: ${String(timestamp)}`);
  }

  const { useCalloutFormat, useListCalloutFormat, skipImages, accountLabel } = options;
  const resources = skipImages
    ? memo.resources.filter(resource => !resource.type.includes('image'))
    : memo.resources;

  const content = rewriteResourceLinks(memo.content, resources);
  const trailing = collectTrailingResources(content, resources);

  const date = toDayKey(timestamp);
  const time = toTimeLabel(timestamp);
  const hour = getHour(timestamp);
  const emoji = getTimeEmoji(hour);
  const accountTag = accountLabel ? ` · ${accountLabel}` : '';

  if (useCalloutFormat) {
    const contentLines = content.trim().split('\n');
    const processedContent = contentLines
      .map(line => (line.trim() ? `> ${line.replace(/[ \t]+$/, '')}` : '>'))
      .join('\n');
    const resourceLines = trailing
      .map(resource => generateResourceLink(resource))
      .filter(Boolean);
    const resourceBlock = resourceLines.length > 0
      ? `\n>\n${resourceLines.map(line => `> ${line}`).join('\n')}`
      : '';
    const header = `> [!${getCalloutType(hour)}] ${emoji} ${time} - ${getTimePeriod(hour)}${accountTag}`;
    return {
      date,
      timestamp: String(timestamp),
      content: `${header}\n${processedContent}${resourceBlock}\n> \n> ^${timestamp}\n`,
    };
  }

  const attachmentLines = trailing
    .map(resource => generateResourceLink(resource))
    .filter(Boolean)
    .map(line => `  - ${line}`)
    .join('\n');

  if (useListCalloutFormat) {
    const merged = content.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    const taskMatch = merged.match(/^(- \[.?\])(.*)/);
    let firstLine: string;
    if (taskMatch) {
      firstLine = `${taskMatch[1]} ${emoji} ${time}${accountTag}${taskMatch[2]}`;
    } else {
      firstLine = `- ${emoji} ${time}${accountTag} ${merged.replace(/^- /, '')}`;
    }
    firstLine += ` ${MEMO_TAG} ^${timestamp}`;
    return {
      date,
      timestamp: String(timestamp),
      content: firstLine + (attachmentLines ? `\n${attachmentLines}` : ''),
    };
  }

  const rawLines = content.trim().split('\n');
  const firstSource = rawLines[0] ?? '';
  const taskMatch = firstSource.match(/^(- \[.?\])(.*)/);
  const firstIsBlock = /^\s*(?:`{3,}|~{3,})/.test(firstSource)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(firstSource);

  let firstLine: string;
  let bodySource: string[];
  if (taskMatch) {
    firstLine = `${taskMatch[1]} ${emoji} ${time}${accountTag}${taskMatch[2]}`;
    bodySource = rawLines.slice(1);
  } else if (firstIsBlock) {
    firstLine = `- ${emoji} ${time}${accountTag}`;
    bodySource = rawLines;
  } else {
    firstLine = `- ${emoji} ${time}${accountTag} ${firstSource.replace(/^- /, '')}`;
    bodySource = rawLines.slice(1);
  }
  firstLine += ` ${MEMO_TAG} ^${timestamp}`;

  const body = indentMemoBody(bodySource);
  if (body.length > 0 && /^\s{2}(?:`{3,}|~{3,}|#{1,6}\s|\||>|-{3,}|\*{3,}|_{3,})/.test(body[0])) {
    body.unshift('');
  }

  return {
    date,
    timestamp: String(timestamp),
    content: firstLine
      + (body.length > 0 ? `\n${body.join('\n')}` : '')
      + (attachmentLines ? `\n${attachmentLines}` : ''),
  };
}

/** Merge todo checkbox states, preferring the local state. */
export function mergeTodoStates(localContent: string, remoteContent: string): string {
  const localTodos = new Map<string, boolean>();
  for (const line of localContent.split('\n')) {
    const match = line.match(/^(\s*-\s*)\[([ xX])\]\s*(.+)$/);
    if (match) localTodos.set(match[3].trim(), match[2].toLowerCase() === 'x');
  }
  if (localTodos.size === 0) return remoteContent;

  return remoteContent
    .split('\n')
    .map(line => {
      const match = line.match(/^(\s*-\s*)\[([ xX])\]\s*(.+)$/);
      if (!match) return line;
      const local = localTodos.get(match[3].trim());
      if (local === undefined) return line;
      return `${match[1]}[${local ? 'x' : ' '}] ${match[3]}`;
    })
    .join('\n');
}

/** Whether two blocks differ only in checkbox state. */
export function isSameExceptTodoStates(left: string, right: string): boolean {
  const normalize = (content: string) => content.replace(/^(\s*-\s*)\[([ xX])\](\s*.+)$/gm, '$1[ ]$3');
  return normalize(left) === normalize(right);
}
