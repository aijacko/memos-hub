/**
 * Path guards. Every user-entered or server-supplied path segment passes
 * through here so a sync can never write outside the vault folder.
 */

import type { FolderDepth } from '../types';
import { formatDate } from './time';

const FORBIDDEN = /[\\/:*?"<>|]/g;

/** Collapse separators, drop empty / `.` segments and fold `..` into `.`. */
export function normalizeVaultPath(value: string, fallback = ''): string {
  const raw = typeof value === 'string' && value.trim() ? value : fallback;
  const segments = raw
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
    .map(segment => (segment === '..' ? '.' : segment))
    .filter(segment => segment !== '.');
  return segments.join('/');
}

/** Single path segment (file or folder name) safe for the vault. */
export function safeSegment(value: string, fallback = 'file'): string {
  const replaced = String(value ?? '')
    .replace(FORBIDDEN, '-')
    .replace(/\.{2,}/g, '.');
  const cleaned = [...replaced].filter(char => char >= ' ').join('').trim();
  const withoutTrailingDots = cleaned.replace(/[. ]+$/, '');
  return withoutTrailingDots && withoutTrailingDots !== '.' ? withoutTrailingDots : fallback;
}

/** Folder path from a user setting, validated segment by segment. */
export function safeDir(value: string | undefined, fallback: string): string {
  const normalized = normalizeVaultPath(value ?? '', '');
  if (!normalized) return fallback;
  const safe = normalized
    .split('/')
    .map(segment => safeSegment(segment, ''))
    .filter(Boolean)
    .join('/');
  return safe || fallback;
}

export function dateSubDir(root: string, depth: FolderDepth, timestamp: number): string {
  if (depth === 'year') return `${root}/${formatDate(timestamp, 'YYYY')}`;
  if (depth === 'yearMonth') return `${root}/${formatDate(timestamp, 'YYYY/MM')}`;
  return root;
}

/** File name for a memo; `prefix` is the account name for multi-account setups. */
export function memoFileName(timestamp: number, format: string, prefix = ''): string {
  const pattern = format && format.trim() ? format : 'YYYY-MM-DD HH-mm-ss';
  const base = safeSegment(formatDate(timestamp, pattern), 'memo');
  const name = prefix ? `${safeSegment(prefix, 'account')}-${base}` : base;
  return `${name}.md`;
}

/** `Memos/a-2.md` for attempt 2. */
export function withSuffix(path: string, attempt: number): string {
  if (attempt <= 1) return path;
  const match = path.match(/^(.*?)(\.[^./]+)?$/);
  const stem = match?.[1] ?? path;
  const ext = match?.[2] ?? '';
  return `${stem}-${attempt}${ext}`;
}

export function parentDir(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function baseName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}
