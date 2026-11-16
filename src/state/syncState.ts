/** Mutable sync bookkeeping persisted through the settings file. */

import type { MemosSettings, StorageMode } from '../types';

export class SyncState {
  constructor(
    private readonly settings: MemosSettings,
    private readonly save: () => Promise<void>,
  ) {}

  getCursor(mode: StorageMode, profileId: string): number {
    const raw = this.settings.lastSyncByProfile[mode]?.[profileId];
    const value = Number(raw ?? 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  setCursor(mode: StorageMode, profileId: string, value: number): void {
    this.settings.lastSyncByProfile[mode][profileId] = String(value);
  }

  getIgnored(profileId: string): string[] {
    return this.settings.ignoredMemoIds[profileId] ?? [];
  }

  setIgnored(profileId: string, ids: string[]): void {
    this.settings.ignoredMemoIds[profileId] = ids;
  }

  getKnown(profileId: string): string[] {
    return this.settings.knownMemoIds[profileId] ?? [];
  }

  setKnown(profileId: string, ids: string[]): void {
    this.settings.knownMemoIds[profileId] = ids;
  }

  /** Daily keys whose note lacked the header; reported once so the cursor is not pinned forever. */
  getHeaderMiss(profileId: string): string[] {
    return this.settings.headerMissDays[profileId] ?? [];
  }

  setHeaderMiss(profileId: string, days: string[]): void {
    this.settings.headerMissDays[profileId] = days;
  }

  markSyncedToday(profileId: string, dateKey: string): void {
    this.settings.lastSyncDateByProfile[profileId] = dateKey;
  }

  async persist(): Promise<void> {
    await this.save();
  }
}
