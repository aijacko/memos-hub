/** File-mode sync: one Markdown note per memo. */

import type { AICleanerPort, MemosApiPort, NoteStorePort } from '../ports';
import type { MemosProfile, MemosSettings, NormalizedMemo, SyncMode } from '../types';
import type { CancelToken, SyncReporter } from '../state/cancel';
import type { SyncState } from '../state/syncState';
import type { AttachmentService } from './attachments';
import { createdTsFilter, updatedTsFilter } from '../adapters/memosHttp';
import {
  extractAccountProperty,
  extractCreatedProperty,
  extractCustomFrontmatterLines,
  extractMemoId,
  extractNoteBody,
  extractStoredHash,
  buildFrontmatter,
  buildLegacyProperties,
  hashBody,
} from '../domain/frontmatter';
import { appendTrailingAttachments, rewriteResourceLinks } from '../domain/markdown';
import { normalizeMemo } from '../domain/memo';
import { baseName, dateSubDir, memoFileName, parentDir, safeDir, withSuffix } from '../domain/paths';
import { buildTagFilter, extractMemoTags, matchesTagFilter } from '../domain/tags';
import { formatDate, formatLocalIso } from '../domain/time';
import { t } from '../i18n/t';

const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const INDEX_DEPTH = 6;
const SKIP_FOLDERS = ['_已删除', '_冲突'];
const DELETED_FOLDER = '_已删除';

export interface FileSyncContext {
  profile: MemosProfile;
  settings: MemosSettings;
  mode: SyncMode;
  multiAccount: boolean;
  api: MemosApiPort;
  notes: NoteStorePort;
  attachments: AttachmentService;
  ai: AICleanerPort;
  state: SyncState;
  reporter: SyncReporter;
  cancel: CancelToken;
}

export interface FileSyncOutcome {
  written: number;
  failures: number;
  cancelled: boolean;
  conflicts: number;
  conflictDir: string | null;
  deletedLocally: number;
  movedToDeleted: number;
  /** The API returned more pages than MAX_PAGES; results may be incomplete. */
  truncated: boolean;
}

export interface VaultIndex {
  byUid: Map<string, string>;
  byTimestamp: Map<string, string>;
  accountByUid: Map<string, string | null>;
}

function isFatalApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(t('API_TOKEN_INVALID'))
    || message.includes(t('NETWORK_ERROR'))
    || message.includes(t('API_410'))
    || message.includes(t('API_URL_INVALID'));
}

function isArchived(memo: NormalizedMemo): boolean {
  return memo.state.toUpperCase() === 'ARCHIVED';
}

async function fetchAll(
  ctx: FileSyncContext,
): Promise<{ memos: NormalizedMemo[]; rawUids: Set<string>; truncated: boolean }> {
  const { profile, mode, api, state, cancel, reporter } = ctx;
  const profileName = profile.name.trim() || profile.id;
  const daysLimit = profile.syncDaysLimit ?? 0;
  const cutoff = daysLimit > 0 ? Math.floor(Date.now() / 1000) - daysLimit * 86400 : 0;
  const lastSync = mode === 'force' ? 0 : state.getCursor('file', profile.id);

  const created = createdTsFilter(cutoff);
  const updated = updatedTsFilter(lastSync);
  const combined = updated && created ? `${updated} && ${created}` : (updated || created);
  const filters = Array.from(new Set([combined, created, '']));

  let lastError: unknown = null;
  for (const filter of filters) {
    try {
      const raw: NormalizedMemo[] = [];
      const uids = new Set<string>();
      let pageToken = '';
      reporter.status(t('PROGRESS_FETCHING', { account: profileName }));

      for (let page = 0; page < MAX_PAGES; page++) {
        if (cancel.isCancelled) break;
        const response = await api.listMemos({ pageSize: PAGE_SIZE, pageToken, filter });
        for (const item of response.memos) {
          const memo = normalizeMemo(item);
          if (!memo) continue;
          uids.add(memo.uid);
          raw.push(memo);
        }
        if (!response.nextPageToken) {
          pageToken = '';
          break;
        }
        pageToken = response.nextPageToken;
        reporter.status(t('PROGRESS_FETCHED', { account: profileName, n: raw.length }));
      }

      return {
        memos: raw.sort((a, b) => a.activityAt - b.activityAt),
        rawUids: uids,
        truncated: Boolean(pageToken),
      };
    } catch (error) {
      lastError = error;
      if (isFatalApiError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(t('FETCH_MEMOS_ERROR'));
}

export async function buildIndex(ctx: FileSyncContext, root: string): Promise<VaultIndex> {
  const files = await ctx.notes.listMarkdown(root, INDEX_DEPTH, SKIP_FOLDERS);
  const index: VaultIndex = { byUid: new Map(), byTimestamp: new Map(), accountByUid: new Map() };
  for (const path of files) {
    let content: string;
    try {
      content = await ctx.notes.read(path);
    } catch {
      continue;
    }
    const uid = extractMemoId(content);
    if (uid) {
      index.byUid.set(uid, path);
      index.accountByUid.set(uid, extractAccountProperty(content));
    }
    const created = extractCreatedProperty(content);
    if (created) {
      const seconds = Math.floor(new Date(created).getTime() / 1000);
      if (Number.isFinite(seconds) && seconds > 0) index.byTimestamp.set(String(seconds), path);
    }
  }
  return index;
}

function belongsToProfile(
  ctx: FileSyncContext,
  index: VaultIndex,
  uid: string,
): boolean {
  if (!ctx.multiAccount) return true;
  const account = index.accountByUid.get(uid);
  const name = ctx.profile.name.trim() || ctx.profile.id;
  return Boolean(account) && (account === name || account === ctx.profile.id);
}

export async function syncFileMode(ctx: FileSyncContext): Promise<FileSyncOutcome> {
  const { profile, settings, reporter, state, cancel } = ctx;
  const accountName = profile.name.trim() || profile.id;
  const root = safeDir(settings.syncTargetDir, 'Memos');
  const outcome: FileSyncOutcome = {
    written: 0,
    failures: 0,
    cancelled: false,
    conflicts: 0,
    conflictDir: null,
    deletedLocally: 0,
    movedToDeleted: 0,
    truncated: false,
  };

  const index = await buildIndex(ctx, root);
  const ignored = new Set(state.getIgnored(profile.id));
  const known = new Set(state.getKnown(profile.id));
  const tagFilter = buildTagFilter(settings.includeTags, settings.excludeTags);
  const daysLimit = profile.syncDaysLimit ?? 0;
  const cutoff = daysLimit > 0 ? Math.floor(Date.now() / 1000) - daysLimit * 86400 : 0;

  const { memos, rawUids, truncated } = await fetchAll(ctx);
  outcome.truncated = truncated;
  if (cancel.isCancelled) {
    outcome.cancelled = true;
    return outcome;
  }

  interface Planned { memo: NormalizedMemo; skip: boolean }
  const planned: Planned[] = [];
  let ignoredDirty = false;
  for (const memo of memos) {
    if (cutoff > 0 && memo.createdAt < cutoff) continue;
    let skip = ignored.has(memo.uid)
      || (settings.skipArchivedMemos && isArchived(memo))
      || !matchesTagFilter(extractMemoTags(memo), tagFilter);
    // A memo whose note disappeared from the vault was deleted by the user:
    // remember it instead of writing the file again.
    if (!skip && known.has(memo.uid) && !index.byUid.has(memo.uid)) {
      ignored.add(memo.uid);
      ignoredDirty = true;
      outcome.deletedLocally++;
      skip = true;
    }
    planned.push({ memo, skip });
  }

  const present = new Set(index.byUid.keys());
  const writtenUids = new Set<string>();
  let maxActivity = 0;
  let earliestFailure = Number.POSITIVE_INFINITY;
  const total = planned.length;
  reporter.status(total > 0
    ? t('PROGRESS_WRITING', { account: accountName, i: 0, n: total })
    : t('PROGRESS_NOTHING', { account: accountName }));

  for (let i = 0; i < planned.length; i++) {
    if (cancel.isCancelled) {
      outcome.cancelled = true;
      break;
    }
    const { memo, skip } = planned[i];
    maxActivity = Math.max(maxActivity, memo.activityAt);
    if (!skip) {
      try {
        const result = await writeMemo(ctx, index, root, memo, accountName);
        outcome.written++;
        writtenUids.add(memo.uid);
        present.add(memo.uid);
        if (result.path) index.byUid.set(memo.uid, result.path);
        if (result.conflict) {
          outcome.conflicts++;
          outcome.conflictDir = conflictDirOf(root, result.path);
        }
      } catch (error) {
        outcome.failures++;
        earliestFailure = Math.min(earliestFailure, memo.activityAt);
        console.warn('[Memos Hub] write failed:', error instanceof Error ? error.message : String(error));
      }
    }
    reporter.progress(accountName, i + 1, total);
  }

  if (outcome.cancelled) return outcome;

  if (settings.handleDeletedMemos
    && ctx.mode === 'force'
    && daysLimit === 0) {
    const alive = new Set(
      memos
        .filter(memo => !(settings.skipArchivedMemos && isArchived(memo)))
        .map(memo => memo.uid),
    );
    outcome.movedToDeleted = await moveDeletedMemos(ctx, index, root, alive);
  }

  // Local deletion protection: a memo that still exists on the server but whose
  // note disappeared from the vault must not be recreated.
  const ignoredAdded: string[] = [];
  for (const uid of known) {
    if (!rawUids.has(uid) || present.has(uid) || ignored.has(uid)) continue;
    ignored.add(uid);
    ignoredAdded.push(uid);
  }
  if (ignoredAdded.length > 0) {
    ignoredDirty = true;
    outcome.deletedLocally += ignoredAdded.length;
  }
  if (ignoredDirty) state.setIgnored(profile.id, Array.from(ignored));

  // Keep uids we have ever seen on disk: incremental runs do not fetch them, so
  // dropping them here would let a later force sync recreate a deleted note.
  const knownNext = new Set<string>(known);
  for (const uid of writtenUids) knownNext.add(uid);
  for (const uid of rawUids) {
    if (present.has(uid)) knownNext.add(uid);
  }
  state.setKnown(profile.id, Array.from(knownNext));

  let newCursor = maxActivity;
  if (outcome.failures > 0) newCursor = Math.min(newCursor, earliestFailure - 1);
  const current = state.getCursor('file', profile.id);
  if (newCursor > current) state.setCursor('file', profile.id, newCursor);

  return outcome;
}

function conflictDirOf(root: string, path?: string): string {
  const dir = path ? parentDir(path) : root;
  return `${dir || root}/_冲突`;
}

export async function resolveTargetPath(
  ctx: FileSyncContext,
  index: VaultIndex,
  root: string,
  memo: NormalizedMemo,
  accountName: string,
): Promise<{ path: string; exists: boolean }> {
  const { settings, notes, multiAccount } = ctx;
  const byUid = index.byUid.get(memo.uid);
  if (byUid) return { path: byUid, exists: true };

  const byTimestamp = index.byTimestamp.get(String(memo.createdAt));
  if (byTimestamp) {
    try {
      const content = await notes.read(byTimestamp);
      const owner = extractMemoId(content);
      if (!owner || owner === memo.uid) return { path: byTimestamp, exists: true };
    } catch {
      // Fall through to the generated path.
    }
  }

  const dir = dateSubDir(root, settings.folderDepth, memo.createdAt);
  const format = settings.fileNameFormat;
  const prefix = multiAccount ? accountName : '';
  const candidate = `${dir}/${memoFileName(memo.createdAt, format, prefix)}`;

  for (let attempt = 1; attempt <= 50; attempt++) {
    const path = withSuffix(candidate, attempt);
    if (!notes.exists(path)) return { path, exists: false };
    let content = '';
    try {
      content = await notes.read(path);
    } catch {
      continue;
    }
    const occupied = extractMemoId(content);
    if (occupied === memo.uid) return { path, exists: true };
    if (!occupied) return { path, exists: true };
  }
  const fallback = `${dir}/${memo.uid}.md`;
  return { path: fallback, exists: notes.exists(fallback) };
}

interface WriteResult {
  path: string;
  conflict: boolean;
}

async function writeMemo(
  ctx: FileSyncContext,
  index: VaultIndex,
  root: string,
  memo: NormalizedMemo,
  accountName: string,
): Promise<WriteResult> {
  const { settings, notes, attachments, ai, api, profile } = ctx;
  const targets = await resolveTargetPath(ctx, index, root, memo, accountName);

  const resources = settings.skipImages
    ? memo.resources.filter(resource => !resource.type.includes('image'))
    : memo.resources;
  for (const resource of resources) {
    try {
      await attachments.ensure(resource, profile, api.getPrefix());
    } catch (error) {
      console.warn('[Memos Hub] attachment skipped:', error instanceof Error ? error.message : String(error));
    }
  }

  let body = rewriteResourceLinks(memo.content, resources);
  body = (await ai.clean(body)).replace(/\r\n?/g, '\n');
  body = appendTrailingAttachments(body, resources);
  const noteBody = body.trim();
  const hash = hashBody(noteBody);
  const tags = extractMemoTags(memo);
  const now = formatDate(Math.floor(Date.now() / 1000), 'YYYY-MM-DD HH-mm-ss');

  let previous = '';
  if (targets.exists) {
    try {
      previous = await notes.read(targets.path);
    } catch {
      previous = '';
    }
  }

  const customLines = settings.useFrontmatter ? extractCustomFrontmatterLines(previous) : [];
  const content = settings.useFrontmatter
    ? `${buildFrontmatter(memo, accountName, tags, hash, customLines)}${noteBody}\n`
    : `${noteBody}${buildLegacyProperties(formatLocalIso(memo.createdAt), memo.uid, hash)}\n`;

  if (previous === content) {
    index.byTimestamp.set(String(memo.createdAt), targets.path);
    index.accountByUid.set(memo.uid, accountName);
    return { path: targets.path, conflict: false };
  }

  let backedUp = false;
  if (previous) {
    const storedHash = extractStoredHash(previous);
    const localBody = extractNoteBody(previous).trim();
    const hashMismatch = storedHash === null || hashBody(localBody) !== storedHash;
    if (hashMismatch && localBody !== noteBody) {
      const backupDir = conflictDirOf(root, targets.path);
      await notes.ensureFolder(backupDir);
      const stem = baseName(targets.path).replace(/\.md$/i, '');
      let backupPath = `${backupDir}/${stem} 冲突 ${now}.md`;
      for (let attempt = 2; notes.exists(backupPath) && attempt < 100; attempt++) {
        backupPath = `${backupDir}/${stem} 冲突 ${now}-${attempt}.md`;
      }
      await notes.copy(targets.path, backupPath);
      backedUp = true;
    }
  }

  if (targets.exists) {
    await notes.modify(targets.path, content);
  } else {
    await notes.create(targets.path, content);
  }
  index.byTimestamp.set(String(memo.createdAt), targets.path);
  index.accountByUid.set(memo.uid, accountName);
  return { path: targets.path, conflict: backedUp };
}

async function moveDeletedMemos(
  ctx: FileSyncContext,
  index: VaultIndex,
  root: string,
  serverUids: Set<string>,
): Promise<number> {
  const { notes } = ctx;
  const targetDir = `${root}/${DELETED_FOLDER}`;
  let moved = 0;
  for (const [uid, path] of index.byUid) {
    if (serverUids.has(uid)) continue;
    if (!belongsToProfile(ctx, index, uid)) continue;
    const name = baseName(path);
    let target = `${targetDir}/${name}`;
    for (let attempt = 2; notes.exists(target) && attempt < 100; attempt++) {
      target = `${targetDir}/${name.replace(/\.md$/i, '')} ${attempt}.md`;
    }
    try {
      await notes.ensureFolder(targetDir);
      await notes.rename(path, target);
      moved++;
    } catch (error) {
      console.warn('[Memos Hub] failed to move deleted memo:', error instanceof Error ? error.message : String(error));
    }
  }
  return moved;
}
