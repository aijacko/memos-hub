/** Normalize raw API memos into the internal model. */

import type { MemoResource, NormalizedMemo, RawAttachment, RawMemo } from '../types';
import { isValidTimestamp, parseIsoSeconds } from './time';

function normalizeResource(raw: RawAttachment): MemoResource {
  const name = String(raw.name ?? '');
  const uid = String(raw.uid ?? '') || name.split('/').pop() || String(raw.id ?? '');
  const size = typeof raw.size === 'number' ? raw.size : Number(raw.size ?? 0);
  return {
    uid: uid || 'resource',
    name,
    filename: String(raw.filename ?? ''),
    type: String(raw.type ?? ''),
    size: Number.isFinite(size) ? size : 0,
    externalLink: String(raw.externalLink ?? ''),
  };
}

/** Creation time, unix seconds (`timestamp` → `createdTs` → `createTime` → `createdAt`). */
export function memoCreatedAt(memo: RawMemo): number | null {
  if (isValidTimestamp(memo.timestamp)) return memo.timestamp;
  if (isValidTimestamp(memo.createdTs)) return memo.createdTs;
  const fromIso = parseIsoSeconds(memo.createTime) ?? parseIsoSeconds(memo.createdAt);
  return isValidTimestamp(fromIso) ? fromIso : null;
}

/** Last-change time reported by the server, when present. */
export function memoRemoteUpdatedAt(memo: RawMemo): number | undefined {
  const parsed = parseIsoSeconds(memo.updateTime);
  return isValidTimestamp(parsed) ? parsed : undefined;
}

export function memoUid(memo: RawMemo): string {
  if (memo.uid) return String(memo.uid);
  if (typeof memo.id === 'string' && memo.id) return memo.id;
  if (memo.name) {
    const parts = memo.name.split('/');
    return parts[parts.length - 1] || '';
  }
  const created = memoCreatedAt(memo);
  return created ? String(created) : '';
}

export function normalizeMemo(memo: RawMemo): NormalizedMemo | null {
  const createdAt = memoCreatedAt(memo);
  if (!isValidTimestamp(createdAt)) return null;

  const uid = memoUid(memo);
  if (!uid) return null;

  const remoteUpdatedAt = memoRemoteUpdatedAt(memo);
  const rawResources = memo.attachments ?? memo.resourceList ?? memo.resources ?? [];

  return {
    uid,
    createdAt,
    activityAt: remoteUpdatedAt ?? createdAt,
    remoteUpdatedAt,
    updateTime: memo.updateTime,
    content: typeof memo.content === 'string' ? memo.content.replace(/\r\n?/g, '\n') : '',
    tags: Array.isArray(memo.tags) ? memo.tags.map(tag => String(tag)) : [],
    visibility: String(memo.visibility ?? 'PRIVATE'),
    state: String(memo.state ?? 'NORMAL'),
    pinned: memo.pinned === true,
    resources: rawResources.map(normalizeResource),
  };
}
