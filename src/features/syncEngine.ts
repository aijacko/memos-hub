/** Orchestrates a sync run across every usable account. */

import { Notice } from 'obsidian';
import type { AICleanerPort, DailyNoteStorePort, NoteStorePort } from '../ports';
import type { MemosProfile, MemosSettings, SyncMode, SyncResult } from '../types';
import type { SyncState } from '../state/syncState';
import type { SyncReporter } from '../state/cancel';
import { CancelToken } from '../state/cancel';
import type { AttachmentService } from './attachments';
import { syncFileMode } from './syncFile';
import { syncDailyMode } from './syncDaily';
import { enabledProfiles, isProfileConfigured } from '../state/settings';
import { toDayKey } from '../domain/time';
import { t } from '../i18n/t';

export interface SyncEngineDeps {
  settings: MemosSettings;
  state: SyncState;
  notes: NoteStorePort;
  dailies: DailyNoteStorePort;
  attachments: AttachmentService;
  ai: AICleanerPort;
  reporter: SyncReporter;
  apiFor: (profile: MemosProfile) => import('../ports').MemosApiPort;
}

export interface EngineResult extends SyncResult {
  cancelled: boolean;
}

/** Profiles that can actually sync (enabled and fully configured). */
export function usableProfiles(settings: MemosSettings): MemosProfile[] {
  return enabledProfiles(settings).filter(isProfileConfigured);
}

/** Startup skip: every usable account already succeeded today. */
export function syncedToday(settings: MemosSettings): boolean {
  const profiles = usableProfiles(settings);
  if (profiles.length === 0) return false;
  const today = toDayKey(Math.floor(Date.now() / 1000));
  return profiles.every(profile => settings.lastSyncDateByProfile[profile.id] === today);
}

export async function runSync(
  deps: SyncEngineDeps,
  mode: SyncMode,
  cancel: CancelToken,
): Promise<EngineResult> {
  const { settings, state } = deps;
  const profiles = usableProfiles(settings);
  const result: EngineResult = {
    attempted: profiles.length,
    succeeded: 0,
    written: 0,
    failures: [],
    cancelled: false,
  };
  if (profiles.length === 0) return result;

  const multiAccount = profiles.length > 1;
  const today = toDayKey(Math.floor(Date.now() / 1000));

  for (const profile of profiles) {
    if (cancel.isCancelled) {
      result.cancelled = true;
      break;
    }
    const account = profile.name.trim() || profile.id;
    let accountFailed = false;
    try {
      const api = deps.apiFor(profile);
      if (settings.storageMode === 'dailyNote') {
        const outcome = await syncDailyMode({
          profile,
          settings,
          mode,
          multiAccount,
          api,
          dailies: deps.dailies,
          notes: deps.notes,
          attachments: deps.attachments,
          ai: deps.ai,
          state,
          reporter: deps.reporter,
          cancel,
        });
        result.written += outcome.written;
        if (outcome.cancelled) result.cancelled = true;

        if (outcome.conflicts > 0) {
          new Notice(t('NOTICE_DAILY_CONFLICT', {
            account,
            n: outcome.conflicts,
            dir: outcome.conflictDir ?? '',
          }), 8000);
        }
        if (outcome.preservedLocal > 0) {
          new Notice(t('NOTICE_DAILY_PRESERVED', { account, n: outcome.preservedLocal }), 6000);
        }
        if (outcome.missingHeaders > 0) {
          new Notice(t('NOTICE_MISSING_HEADER', {
            n: outcome.missingHeaders,
            header: settings.dailyMemoHeader,
          }), 10000);
        }
        if (outcome.truncated) {
          new Notice(t('NOTICE_FETCH_TRUNCATED', { account }), 10000);
        }
        if (outcome.failures > 0) {
          const message = t('NOTICE_DAILY_FAILED', { account, n: outcome.failures });
          new Notice(message, 8000);
          result.failures.push({ profileId: profile.id, name: account, message });
          accountFailed = true;
        }
      } else {
        const outcome = await syncFileMode({
          profile,
          settings,
          mode,
          multiAccount,
          api,
          notes: deps.notes,
          attachments: deps.attachments,
          ai: deps.ai,
          state,
          reporter: deps.reporter,
          cancel,
        });
        result.written += outcome.written;
        if (outcome.cancelled) result.cancelled = true;

        if (outcome.conflicts > 0) {
          new Notice(t('NOTICE_CONFLICT_BACKUP', {
            n: outcome.conflicts,
            dir: outcome.conflictDir ?? `${settings.syncTargetDir}/_冲突`,
          }), 8000);
        }
        if (outcome.deletedLocally > 0) {
          new Notice(t('NOTICE_LOCAL_DELETED', { account, n: outcome.deletedLocally }), 8000);
        }
        if (outcome.truncated) {
          new Notice(t('NOTICE_FETCH_TRUNCATED', { account }), 10000);
        }
        if (outcome.localEmpty) {
          new Notice(t('NOTICE_LOCAL_EMPTY', { account }), 12000);
        }
        if (outcome.failures > 0) {
          new Notice(t('NOTICE_WRITE_FAILED', { account, n: outcome.failures }), 8000);
          result.failures.push({ profileId: profile.id, name: account, message: t('NOTICE_WRITE_FAILED', { account, n: outcome.failures }) });
          accountFailed = true;
        }
      }

      // "Synced today" only when this account had no write failures, otherwise
      // the startup skip would hide the failed memos (F34).
      if (!result.cancelled && !accountFailed) {
        result.succeeded++;
        state.markSyncedToday(profile.id, today);
      }
    } catch (error) {
      if (cancel.isCancelled) {
        result.cancelled = true;
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      result.failures.push({ profileId: profile.id, name: account, message });
      console.error(`[Memos Hub] sync failed for ${account}:`, message);
    }
  }

  if (result.failures.length > 0 && !result.cancelled) {
    settings.lastSyncFailures = result.failures;
    settings.lastSyncFailedAt = Date.now();
  } else if (result.failures.length === 0 && !result.cancelled) {
    settings.lastSyncFailures = [];
    settings.lastSyncFailedAt = 0;
  }
  await state.persist();
  return result;
}
