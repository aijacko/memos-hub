/** Contract between the settings UI and the plugin. */

import type { App } from 'obsidian';
import type { AISettings, MemosProfile, MemosSettings, SyncMode } from '../types';

export interface SettingsUiHost {
  app: App;
  settings: MemosSettings;
  version: string;
  author: string;
  authorUrl: string;
  saveSettings(): Promise<void>;
  rerenderSettings(): void;
  isSyncing(): boolean;
  isCancelling(): boolean;
  startSync(mode: SyncMode): void;
  cancelSync(): void;
  addProfile(): Promise<void>;
  removeProfile(profileId: string): Promise<void>;
  testProfile(profile: MemosProfile): Promise<{ success: boolean; message: string }>;
  testAI(): Promise<{ success: boolean; message: string }>;
  fetchModels(): Promise<{ success: boolean; models: string[]; message?: string }>;
  aiSettings(): AISettings;
  conflictDirs(): string[];
  openFolder(path: string): Promise<void>;
  cleanBackups(days: number): Promise<number>;
  clearIgnored(): Promise<void>;
  resetSettings(): Promise<void>;
}

export interface SettingsContext {
  host: SettingsUiHost;
  container: HTMLElement;
  rerender(): void;
}
