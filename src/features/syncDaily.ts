/** Daily-note mode sync: merge memos into the note of their creation day. */

import type { AICleanerPort, DailyNoteStorePort, MemosApiPort, NoteStorePort } from '../ports';
import type { MemosProfile, MemosSettings, NormalizedMemo, SyncMode } from '../types';
import type { CancelToken, SyncReporter } from '../state/cancel';
import type { SyncState } from '../state/syncState';
import type { AttachmentService } from './attachments';
import { createdTsFilter } from '../adapters/memosHttp';
import { hasHeaderSection, modifyDailyNote, type DailyConflict } from '../domain/dailyBlocks';
import { renderDailyBlock } from '../domain/markdown';
import { normalizeMemo } from '../domain/memo';
import { safeDir, safeSegment } from '../domain/paths';
import { buildTagFilter, extractMemoTags, matchesTagFilter } from '../domain/tags';
import { toDayKey } from '../domain/time';
import { t } from '../i18n/t';

const PAGE_SIZE = 200;
const MAX_PAGES = 200;

export interface DailySyncContext {
  profile: MemosProfile;
  settings: MemosSettings;
  mode: SyncMode;
  multiAccount: boolean;
  api: MemosApiPort;
  dailies: DailyNoteStorePort;
  notes: NoteStorePort;
  attachments: AttachmentService;
  ai: AICleanerPort;
  state: SyncState;
  reporter: SyncReporter;
  cancel: CancelToken;
}

export interface DailySyncOutcome {
  written: number;
  failures: number;
  cancelled: boolean;
  missingHeaders: number;
  conflicts: number;
  preservedLocal: number;
  conflictDir: string | null;
  /** The API returned more pages than MAX_PAGES; results may be incomplete. */
  truncated: boolean;
}

function isFatalApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(t('API_TOKEN_INVALID'))
    || message.includes(t('NETWORK_ERROR'))
    || message.includes(t('API_410'))
    || message.includes(t('API_URL_INVALID'));
}

async function fetchMemos(
  ctx: DailySyncContext,
  cursor: number,
  cutoff: number,
): Promise<{ memos: NormalizedMemo[]; truncated: boolean }> {
  const { api, reporter, cancel, profile } = ctx;
  const account = profile.name.trim() || profile.id;
  const created = createdTsFilter(cutoff);
  const filters = Array.from(new Set([created, '']));

  let lastError: unknown = null;
  for (const filter of filters) {
    try {
      const memos: NormalizedMemo[] = [];
      let pageToken = '';
      reporter.status(t('PROGRESS_FETCHING', { account }));
      for (let page = 0; page < MAX_PAGES; page++) {
        if (cancel.isCancelled) break;
        const response = await api.listMemos({ pageSize: PAGE_SIZE, pageToken, filter });
        for (const item of response.memos) {
          const memo = normalizeMemo(item);
          if (memo) memos.push(memo);
        }
        if (!response.nextPageToken) {
          pageToken = '';
          break;
        }
        pageToken = response.nextPageToken;
        reporter.status(t('PROGRESS_FETCHED', { account, n: memos.length }));
      }
      return {
        memos: memos.sort((a, b) => a.createdAt - b.createdAt),
        truncated: Boolean(pageToken),
      };
    } catch (error) {
      lastError = error;
      if (isFatalApiError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(t('FETCH_MEMOS_ERROR'));
}

function conflictDir(root: string): string {
  return `${root}/_冲突`;
}

export async function syncDailyMode(ctx: DailySyncContext): Promise<DailySyncOutcome> {
  const { profile, settings, state, cancel, reporter, api, dailies, notes, attachments, ai, multiAccount } = ctx;
  const account = profile.name.trim() || profile.id;
  const root = safeDir(settings.syncTargetDir, 'Memos');
  const outcome: DailySyncOutcome = {
    written: 0,
    failures: 0,
    cancelled: false,
    missingHeaders: 0,
    conflicts: 0,
    preservedLocal: 0,
    conflictDir: null,
    truncated: false,
  };

  const storedCursor = state.getCursor('dailyNote', profile.id);
  const cursor = ctx.mode === 'force' ? 0 : storedCursor;
  const daysLimit = profile.syncDaysLimit ?? 0;
  const cutoff = daysLimit > 0 ? Math.floor(Date.now() / 1000) - daysLimit * 86400 : 0;
  // Force sync rebuilds everything, so the local-delete ignore list does not apply.
  const ignored = new Set(ctx.mode === 'force' ? [] : state.getIgnored(profile.id));
  const tagFilter = buildTagFilter(settings.includeTags, settings.excludeTags);
  const knownMissDays = new Set(state.getHeaderMiss(profile.id));
  let missDirty = false;

  const { memos: all, truncated } = await fetchMemos(ctx, cursor, cutoff);
  outcome.truncated = truncated;
  if (cancel.isCancelled) {
    outcome.cancelled = true;
    return outcome;
  }

  const selected = all.filter(memo => {
    if (cutoff > 0 && memo.createdAt < cutoff) return false;
    if (cursor > 0 && memo.activityAt <= cursor) return false;
    if (ignored.has(memo.uid)) return false;
    if (settings.skipArchivedMemos && memo.state.toUpperCase() === 'ARCHIVED') return false;
    return matchesTagFilter(extractMemoTags(memo), tagFilter);
  });

  if (selected.length === 0) {
    reporter.status(t('PROGRESS_NOTHING', { account }));
    return outcome;
  }

  // Memos excluded by the tag filter still exist on the server: keep their
  // blocks so a full sync does not mistake them for deleted memos.
  const retainedTimestamps = new Set<number>();
  for (const memo of all) {
    if (cutoff > 0 && memo.createdAt < cutoff) continue;
    if (settings.skipArchivedMemos
      && settings.keepArchivedDailyBlocks
      && memo.state.toUpperCase() === 'ARCHIVED') {
      retainedTimestamps.add(memo.createdAt);
      continue;
    }
    if (matchesTagFilter(extractMemoTags(memo), tagFilter)) continue;
    retainedTimestamps.add(memo.createdAt);
  }

  // Download attachments first so rendering can embed local paths.
  reporter.status(t('PROGRESS_DOWNLOAD_ATTACHMENTS', { account }));
  for (const memo of selected) {
    if (cancel.isCancelled) break;
    for (const resource of memo.resources) {
      try {
        await attachments.ensure(resource, profile, api.getPrefix());
      } catch (error) {
        console.warn('[Memos Hub] attachment skipped:', error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (cancel.isCancelled) {
    outcome.cancelled = true;
    return outcome;
  }

  const byDay = new Map<string, NormalizedMemo[]>();
  for (const memo of selected) {
    const day = toDayKey(memo.createdAt);
    const list = byDay.get(day) ?? [];
    list.push(memo);
    byDay.set(day, list);
  }

  const dayKeys = Array.from(byDay.keys()).sort();
  let maxCreation = 0;
  // A day that could not be written (missing daily note, missing header or a
  // write error) pulls the cursor back, otherwise its memos are never retried.
  let cursorCap = Number.POSITIVE_INFINITY;
  const totalMemos = selected.length;
  let processedMemos = 0;

  for (const day of dayKeys) {
    if (cancel.isCancelled) {
      outcome.cancelled = true;
      break;
    }
    const memos = byDay.get(day) ?? [];
    const dayFailureCap = Math.min(...memos.map(memo => memo.createdAt)) - 1;
    maxCreation = Math.max(maxCreation, ...memos.map(memo => memo.createdAt));
    processedMemos += memos.length;

    let path = dailies.find(day);
    if (!path) {
      if (settings.createMissingDailyNotes) {
        try {
          path = await dailies.create(day);
        } catch (error) {
          console.warn('[Memos Hub] failed to create daily note:', error instanceof Error ? error.message : String(error));
        }
      }
      if (!path) {
        outcome.failures++;
        cursorCap = Math.min(cursorCap, dayFailureCap);
        reporter.progress(account, processedMemos, totalMemos);
        continue;
      }
    }

    try {
      const origin = await dailies.read(path);
      if (!hasHeaderSection(origin, settings.dailyMemoHeader)) {
        outcome.missingHeaders++;
        // Report each header-less day once. Capping the cursor on every run would
        // clone the whole backlog forever when the user never adds the header.
        if (!knownMissDays.has(day)) {
          knownMissDays.add(day);
          missDirty = true;
          cursorCap = Math.min(cursorCap, dayFailureCap);
        }
        reporter.progress(account, processedMemos, totalMemos);
        continue;
      }
      if (knownMissDays.delete(day)) missDirty = true;

      const fetched: Record<string, string> = {};
      const updatedAt: Record<string, number> = {};
      for (const memo of memos) {
        const content = (await ai.clean(memo.content)).replace(/\r\n?/g, '\n');
        const block = renderDailyBlock({ ...memo, content }, {
          useCalloutFormat: settings.useCalloutFormat,
          useListCalloutFormat: settings.useListCalloutFormat,
          skipImages: settings.skipImages,
          accountLabel: multiAccount ? account : undefined,
        });
        fetched[String(memo.createdAt)] = block.content;
        updatedAt[String(memo.createdAt)] = memo.remoteUpdatedAt ?? memo.createdAt;
      }

      const result = modifyDailyNote(origin, settings.dailyMemoHeader, fetched, {
        // Deletions only on an explicit force sync (§9.1). With a day window
        // older memos are never fetched, so a "missing" block does not prove
        // the memo was deleted remotely.
        isIncrementalSync: ctx.mode !== 'force' || daysLimit > 0,
        retainedTimestamps,
        deletionAccountLabel: multiAccount ? account : undefined,
        lastSyncTime: storedCursor,
        remoteUpdatedAt: updatedAt,
      });

      if (result) {
        if (result.conflicts.length > 0) {
          await backupConflicts(notes, root, result.conflicts, account);
          outcome.conflicts += result.conflicts.length;
          outcome.conflictDir = conflictDir(root);
        }
        outcome.preservedLocal += result.preservedLocal.length;
        if (result.content !== origin) {
          // A long sync gives the user time to edit the note; never clobber those edits.
          const latest = await dailies.read(path);
          if (latest !== origin) {
            outcome.failures++;
            cursorCap = Math.min(cursorCap, dayFailureCap);
            console.warn('[Memos Hub] daily note changed during sync, deferred:', path);
          } else {
            await dailies.write(path, result.content);
            outcome.written++;
          }
        }
      }
    } catch (error) {
      outcome.failures++;
      cursorCap = Math.min(cursorCap, dayFailureCap);
      console.warn('[Memos Hub] daily note write failed:', error instanceof Error ? error.message : String(error));
    }
    reporter.progress(account, processedMemos, totalMemos);
  }

  if (outcome.cancelled) return outcome;

  if (missDirty) state.setHeaderMiss(profile.id, Array.from(knownMissDays));

  let newCursor = maxCreation;
  if (cursorCap < Number.POSITIVE_INFINITY) newCursor = Math.min(newCursor, cursorCap);
  if (newCursor > 0 && newCursor > storedCursor) state.setCursor('dailyNote', profile.id, newCursor);

  return outcome;
}

async function backupConflicts(
  notes: NoteStorePort,
  root: string,
  conflicts: DailyConflict[],
  account: string,
): Promise<void> {
  const dir = conflictDir(root);
  await notes.ensureFolder(dir);
  const label = safeSegment(account, 'account');
  for (const conflict of conflicts) {
    let path = `${dir}/日记冲突 ${label} ${conflict.timestamp}.md`;
    for (let attempt = 2; notes.exists(path) && attempt < 100; attempt++) {
      path = `${dir}/日记冲突 ${label} ${conflict.timestamp}-${attempt}.md`;
    }
    const content = `# 远端版本（覆盖前）\n\n${conflict.remoteContent}\n\n---\n\n# 本地版本（已备份）\n\n${conflict.localContent}\n`;
    await notes.create(path, content);
  }
}
