/** Note properties: frontmatter, legacy callout, body hash, user keys. */

import type { NormalizedMemo } from '../types';
import { formatLocalIso } from './time';

/** Frontmatter keys owned by the plugin; everything else belongs to the user. */
export const MANAGED_KEYS = new Set([
  'memo_id',
  'account',
  'memo_hash',
  'created',
  'updated',
  'visibility',
  'pinned',
  'tags',
]);

/** YAML-safe scalar; quotes values that would parse as numbers or booleans. */
export function yamlValue(value: string): string {
  const plain = /^[\w\u4e00-\u9fff./-]+$/.test(value)
    && !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value)
    && !/^(true|false|null|yes|no|on|off)$/i.test(value);
  return plain ? value : JSON.stringify(value);
}

/** FNV-1a hash + length, used to detect local edits (not for security). */
export function hashBody(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
}

export function buildFrontmatter(
  memo: NormalizedMemo,
  accountName: string,
  tags: string[],
  bodyHash: string,
  customLines: string[] = [],
): string {
  const lines = [
    '---',
    `memo_id: ${yamlValue(memo.uid)}`,
    `account: ${yamlValue(accountName)}`,
    `created: ${formatLocalIso(memo.createdAt)}`,
    `memo_hash: ${bodyHash}`,
  ];
  if (memo.updateTime) lines.push(`updated: ${memo.updateTime}`);
  lines.push(`visibility: ${memo.visibility || 'PRIVATE'}`);
  lines.push(`pinned: ${memo.pinned ? 'true' : 'false'}`);
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) lines.push(`  - ${yamlValue(tag)}`);
  }
  if (customLines.length > 0) lines.push(...customLines);
  lines.push('---', '');
  return lines.join('\n');
}

export function buildLegacyProperties(createdLabel: string, uid: string, bodyHash: string): string {
  return `\n\n---\n\n> [!note]- Memo Properties\n> - Created: ${createdLabel}\n> - Type: memo\n> - ID: memos/${uid}\n> - Hash: ${bodyHash}`;
}

/** Note body without the frontmatter block or the legacy properties callout. */
export function extractNoteBody(content: string): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (frontmatter) {
    return content.slice(frontmatter[0].length).replace(/^\r?\n/, '');
  }
  const index = content.indexOf('\n\n---\n\n> [!note]- Memo Properties');
  return index === -1 ? content : content.slice(0, index);
}

/** Hash written by the previous sync, or null for notes from older versions. */
export function extractStoredHash(content: string): string | null {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const match = frontmatter[1].match(/^memo_hash:\s*"?([^"\n]+)"?/m);
    return match ? match[1].trim() : null;
  }
  const match = content.match(/^> - Hash:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/** `memo_id` from frontmatter or the legacy `ID: memos/...` line. */
export function extractMemoId(content: string): string | null {
  const match = content.match(/^memo_id:\s*"?([^"\n]+)"?/m) ?? content.match(/^> - ID: memos\/(\S+)/m);
  const id = match?.[1]?.trim();
  return id ? id : null;
}

/** `account` property, used to tell accounts apart in a shared folder. */
export function extractAccountProperty(content: string): string | null {
  const match = content.match(/^account:\s*"?([^"\n]+)"?/m);
  return match?.[1]?.trim() ?? null;
}

/** Creation time from the `created:` property, used to build the timestamp index. */
export function extractCreatedProperty(content: string): string | null {
  const match = content.match(/^created:\s*"?([^"\n]+)"?/m);
  return match?.[1]?.trim() ?? null;
}

/**
 * Lines of user-defined frontmatter keys (with their indented continuation
 * lines) so a custom `status:` / `rating:` field survives every rewrite.
 */
export function extractCustomFrontmatterLines(content: string): string[] {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return [];

  const kept: string[] = [];
  let inCustomBlock = false;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const isListItem = /^-\s/.test(line);
    const keyMatch = isListItem ? null : line.match(/^(?:"([^"]+)"|([^:\s][^:]*?))\s*:(?:\s|$)/);
    if (keyMatch) {
      const key = (keyMatch[1] ?? keyMatch[2] ?? '').trim();
      inCustomBlock = !MANAGED_KEYS.has(key);
      if (inCustomBlock) kept.push(line);
      continue;
    }
    if (inCustomBlock && (/^\s+\S/.test(line) || /^-\s/.test(line) || line.trim() === '')) {
      kept.push(line);
    } else if (line.trim() !== '') {
      inCustomBlock = false;
    }
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  return kept;
}
