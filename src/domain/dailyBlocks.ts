/** Daily-note section parsing and merging (pure). */

import { isSameExceptTodoStates, mergeTodoStates } from './markdown';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sectionRegExp(header: string): RegExp {
  const trimmed = header.trim();
  const line = /^#+/.test(trimmed) ? trimmed : `# ${trimmed}`;
  return new RegExp(`(${escapeRegExp(line)}[^\\n]*)([\\s\\S]*?)(?=\\n#|$)`);
}

/** Whether the note contains the configured memos section header. */
export function hasHeaderSection(content: string, header: string): boolean {
  return sectionRegExp(header).test(content);
}

/** Split the section body into memo blocks (`- ` items or `> [!` callouts). */
export function splitBlocks(sectionText: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const text = current.join('\n').trim();
    if (text) blocks.push(text);
    current = [];
  };
  for (const line of sectionText.split('\n')) {
    if (/^- /.test(line) || /^> \[!/.test(line)) flush();
    current.push(line);
  }
  flush();
  return blocks;
}

function belongsToAccount(block: string, accountLabel: string): boolean {
  const firstLine = block.split('\n')[0] ?? '';
  return firstLine.includes(`· ${accountLabel} `) || firstLine.endsWith(`· ${accountLabel}`);
}

export interface DailyConflict {
  timestamp: string;
  localContent: string;
  remoteContent: string;
}

export interface DailyModifyOptions {
  isIncrementalSync: boolean;
  /** Set when several accounts share this header; limits deletion to own blocks. */
  deletionAccountLabel?: string;
  /** Cursor of the previous sync, used to spot blocks edited only locally. */
  lastSyncTime?: number;
  remoteUpdatedAt?: Record<string, number>;
  /** Timestamps still on the server but skipped by filters: never delete their blocks. */
  retainedTimestamps?: ReadonlySet<number>;
}

export interface DailyModifyResult {
  content: string;
  preservedLocal: string[];
  conflicts: DailyConflict[];
}

/**
 * Merge fetched memo blocks into the daily note section.
 * Returns undefined when nothing has to be written.
 */
export function modifyDailyNote(
  originContent: string,
  header: string,
  fetched: Record<string, string>,
  options: DailyModifyOptions,
): DailyModifyResult | undefined {
  const {
    isIncrementalSync,
    deletionAccountLabel,
    lastSyncTime = 0,
    remoteUpdatedAt,
  } = options;

  const match = originContent.match(sectionRegExp(header));
  if (!match || match.index === undefined) return undefined;

  const headerLine = match[1];
  const sectionText = match[2] ?? '';
  const prefix = originContent.slice(0, match.index + headerLine.length);
  const suffix = originContent.slice(match.index + match[0].length);

  const existing = new Map<string, string>();
  for (const block of splitBlocks(sectionText.trim())) {
    const timestamp = block.match(/\^(\d+)/)?.[1];
    if (timestamp) existing.set(timestamp, block);
  }

  const updates = new Map<string, string>();
  const additions = new Map<string, string>();
  const deletions = new Set<string>();
  const preservedLocal: string[] = [];
  const conflicts: DailyConflict[] = [];

  for (const [timestamp, content] of Object.entries(fetched)) {
    const existingContent = existing.get(timestamp);
    if (existingContent === undefined) {
      additions.set(timestamp, content);
      continue;
    }

    if (isSameExceptTodoStates(existingContent, content)) {
      const merged = mergeTodoStates(existingContent, content);
      if (merged !== existingContent) updates.set(timestamp, merged);
      continue;
    }

    if (existingContent === content) continue;

    const remoteUpdate = remoteUpdatedAt?.[timestamp];
    if (remoteUpdate !== undefined && lastSyncTime > 0 && remoteUpdate <= lastSyncTime) {
      preservedLocal.push(timestamp);
      continue;
    }

    conflicts.push({ timestamp, localContent: existingContent, remoteContent: content });
    updates.set(timestamp, mergeTodoStates(existingContent, content));
  }

  // Deletions are only detected on a full sync.
  const retained = options.retainedTimestamps;
  if (!isIncrementalSync) {
    for (const [timestamp, content] of existing) {
      if (fetched[timestamp]) continue;
      if (retained?.has(Number(timestamp))) continue;
      if (deletionAccountLabel && !belongsToAccount(content, deletionAccountLabel)) continue;
      deletions.add(timestamp);
    }
  }

  if (updates.size === 0 && additions.size === 0 && deletions.size === 0) {
    if (preservedLocal.length === 0) return undefined;
    return { content: originContent, preservedLocal, conflicts: [] };
  }

  const all = new Map<string, string>();
  for (const [timestamp, content] of existing) {
    if (!deletions.has(timestamp) && !updates.has(timestamp)) all.set(timestamp, content);
  }
  for (const [timestamp, content] of updates) all.set(timestamp, content);
  for (const [timestamp, content] of additions) all.set(timestamp, content);

  const sorted = Array.from(all.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
  // Without a blank line the next callout would be swallowed by the previous one.
  const separator = sorted.length > 0 && sorted.every(([, content]) => content.startsWith('>')) ? '\n\n' : '\n';
  const blockText = sorted.map(([, content]) => content).join(separator);

  const content = `${prefix.trim()}\n\n${blockText}\n\n${suffix.trim()}\n`;
  return { content, preservedLocal, conflicts };
}
