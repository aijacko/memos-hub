/** Tag collection and filtering. */

import type { NormalizedMemo } from '../types';

/** Blank out code segments so sample hashtags are not collected. */
function stripCode(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

/** A tag must contain at least one non-numeric character. */
export function isValidTag(tag: string): boolean {
  return tag.length > 0 && /[^\d_\-/]/.test(tag);
}

/** API tags plus inline `#hashtags`, de-duplicated, order preserved. */
export function extractMemoTags(memo: Pick<NormalizedMemo, 'tags' | 'content'>, content = memo.content): string[] {
  const tags = new Set<string>();
  const add = (raw: unknown) => {
    const tag = String(raw).replace(/^#/, '').trim();
    if (isValidTag(tag)) tags.add(tag);
  };
  for (const raw of memo.tags ?? []) add(raw);
  const text = stripCode(content);
  const re = /(^|[\s(（])#([\p{L}\p{N}_/-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    add(match[2]);
  }
  return Array.from(tags);
}

/** `a, #b` → `['a', 'b']`. */
export function parseTagList(value: string): string[] {
  return String(value ?? '')
    .split(',')
    .map(tag => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
}

export interface TagFilter {
  include: string[];
  exclude: string[];
}

export function buildTagFilter(includeValue: string, excludeValue: string): TagFilter {
  return {
    include: parseTagList(includeValue).map(tag => tag.toLowerCase()),
    exclude: parseTagList(excludeValue).map(tag => tag.toLowerCase()),
  };
}

export function matchesTagFilter(tags: string[], filter: TagFilter): boolean {
  if (filter.include.length === 0 && filter.exclude.length === 0) return true;
  const lowered = tags.map(tag => tag.toLowerCase());
  if (filter.exclude.some(tag => lowered.includes(tag))) return false;
  if (filter.include.length > 0 && !filter.include.some(tag => lowered.includes(tag))) return false;
  return true;
}
