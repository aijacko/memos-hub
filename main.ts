/** Memos Hub entry point: wiring, commands, scheduling and sending. */

import {
  FileSystemAdapter,
  Menu,
  Notice,
  Plugin,
  TFile,
  type Editor,
} from 'obsidian';
import type { AISettings, MemosProfile, MemosSettings, SyncMode } from './src/types';
import type { SyncReporter } from './src/state/cancel';
import type { SettingsUiHost } from './src/ui/context';
import { AIService } from './src/adapters/ai';
import { MemosHttpApi } from './src/adapters/memosHttp';
import { ObsidianDailyNotes } from './src/adapters/obsidianDailyNotes';
import { VaultAttachmentStore } from './src/adapters/vaultAttachments';
import { VaultNoteStore } from './src/adapters/vaultNotes';
import { safeDir } from './src/domain/paths';
import { t, initLanguage } from './src/i18n/t';
import { AttachmentService } from './src/features/attachments';
import { sendMemo } from './src/features/sender';
import { runSync, syncedToday, usableProfiles, type EngineResult } from './src/features/syncEngine';
import {
  createDefaultSettings,
  createProfile,
  normalizeSettings,
  resolveSendProfile,
} from './src/state/settings';
import { CancelToken } from './src/state/cancel';
import { SyncState } from './src/state/syncState';
import { MemosHubSettingTab } from './src/ui/settingsTab';
import { AccountPickModal, ConfirmModal, QuickCaptureModal } from './src/ui/modals';

interface ProgressTarget {
  setMessage(message: string): void;
  hide(): void;
}

export default class MemosHubPlugin extends Plugin implements SettingsUiHost {
  settings!: MemosSettings;

  private notes!: VaultNoteStore;
  private dailies!: ObsidianDailyNotes;
  private attachments!: AttachmentService;
  private ai!: AIService;
  private state!: SyncState;
  private settingsTab!: MemosHubSettingTab;

  private syncing = false;
  private cancelling = false;
  private cancelToken: CancelToken | null = null;
  private progressNotice: ProgressTarget | null = null;
  private lastProgressAt = 0;
  private startupTimer: number | null = null;
  private periodicTimer: number | null = null;

  async onload(): Promise<void> {
    initLanguage();
    await this.loadSettings();
    this.buildServices();

    this.settingsTab = new MemosHubSettingTab(this);
    this.addSettingTab(this.settingsTab);

    this.addRibbonIcon('notebook-pen', t('CMD_QUICK_CAPTURE'), () => this.openQuickCapture());
    this.registerCommands();
    this.registerMenus();

    this.scheduleStartupSync();
    this.schedulePeriodicSync();
  }

  onunload(): void {
    if (this.startupTimer !== null) {
      window.clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.periodicTimer !== null) {
      window.clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    this.progressNotice?.hide();
    this.progressNotice = null;
    this.cancelToken?.cancel();
    this.cancelToken = null;
  }

  // ---------------------------------------------------------------- settings

  get version(): string {
    return this.manifest.version;
  }

  get author(): string {
    return this.manifest.author;
  }

  get authorUrl(): string {
    return this.manifest.authorUrl ?? '';
  }

  private async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    this.settings = normalizeSettings(raw);
    await this.saveData(this.settings);
  }

  private buildServices(): void {
    this.notes = new VaultNoteStore(this.app);
    this.dailies = new ObsidianDailyNotes(this.app);
    this.attachments = new AttachmentService(
      new VaultAttachmentStore(this.app),
      () => this.settings.attachmentFolderPath,
      () => this.settings.skipImages,
    );
    this.ai = new AIService(() => this.settings.ai);
    this.state = new SyncState(this.settings, () => this.saveData(this.settings));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.schedulePeriodicSync();
  }

  rerenderSettings(): void {
    if (this.settingsTab?.containerEl?.isConnected) this.settingsTab.display();
  }

  aiSettings(): AISettings {
    return this.settings.ai;
  }

  async addProfile(): Promise<void> {
    const profile = createProfile(this.settings.profiles.length + 1);
    this.settings.profiles.push(profile);
    if (!this.settings.defaultProfileId) this.settings.defaultProfileId = profile.id;
    await this.saveSettings();
    this.rerenderSettings();
  }

  async removeProfile(profileId: string): Promise<void> {
    this.settings.profiles = this.settings.profiles.filter(profile => profile.id !== profileId);
    if (this.settings.defaultProfileId === profileId) this.settings.defaultProfileId = '';
    delete this.settings.lastSyncByProfile.file[profileId];
    delete this.settings.lastSyncByProfile.dailyNote[profileId];
    delete this.settings.lastSyncDateByProfile[profileId];
    delete this.settings.ignoredMemoIds[profileId];
    delete this.settings.knownMemoIds[profileId];
    await this.saveSettings();
    this.rerenderSettings();
  }

  async resetSettings(): Promise<void> {
    const defaults = createDefaultSettings();
    const preserved = {
      profiles: this.settings.profiles,
      defaultProfileId: this.settings.defaultProfileId,
      lastSyncByProfile: this.settings.lastSyncByProfile,
      lastSyncDateByProfile: this.settings.lastSyncDateByProfile,
      lastSyncFailedAt: this.settings.lastSyncFailedAt,
      lastSyncFailures: this.settings.lastSyncFailures,
      ignoredMemoIds: this.settings.ignoredMemoIds,
      knownMemoIds: this.settings.knownMemoIds,
    };
    this.settings = { ...defaults, ...preserved };
    this.buildServices();
    await this.saveSettings();
    new Notice(t('RESET_DONE'));
    this.rerenderSettings();
  }

  // ---------------------------------------------------------------- commands

  private registerCommands(): void {
    this.addCommand({ id: 'sync-memos', name: t('SYNC_MEMOS'), callback: () => this.startSync('smart') });
    this.addCommand({ id: 'incremental-sync', name: t('INCREMENTAL_SYNC_MEMOS'), callback: () => this.startSync('incremental') });
    this.addCommand({ id: 'force-sync', name: t('FORCE_SYNC_MEMOS'), callback: () => this.startSync('force') });
    this.addCommand({
      id: 'send-selection',
      name: t('CMD_SEND_SELECTION'),
      editorCallback: (editor: Editor) => {
        void this.sendSelection(editor);
      },
    });
    this.addCommand({
      id: 'send-note',
      name: t('CMD_SEND_NOTE'),
      callback: () => void this.sendActiveNote(),
    });
    this.addCommand({
      id: 'quick-capture',
      name: t('CMD_QUICK_CAPTURE'),
      callback: () => this.openQuickCapture(),
    });
  }

  private registerMenus(): void {
    this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
      menu.addItem(item => item
        .setTitle(t('CMD_SEND_SELECTION'))
        .setIcon('send')
        .onClick(() => void this.sendSelection(editor)));
      menu.addItem(item => item
        .setTitle(t('CMD_SEND_NOTE'))
        .setIcon('file-up')
        .onClick(() => void this.sendActiveNote()));
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem(item => item
        .setTitle(t('MENU_SEND_TO_MEMOS'))
        .setIcon('send')
        .onClick(() => void this.sendNoteFile(file)));
    }));
  }

  // ------------------------------------------------------------------- sync

  isSyncing(): boolean {
    return this.syncing;
  }

  isCancelling(): boolean {
    return this.cancelling;
  }

  startSync(mode: SyncMode): void {
    if (this.syncing) {
      new Notice(t('SYNC_ALREADY_RUNNING'));
      return;
    }
    if (mode === 'force') {
      new ConfirmModal(this.app, t('CONFIRM_FORCE_SYNC'), () => void this.performSync('force')).open();
      return;
    }
    void this.performSync(mode);
  }

  cancelSync(): void {
    if (!this.cancelToken) return;
    this.cancelling = true;
    this.setProgress(t('SYNC_CANCELING'), true);
    this.cancelToken.cancel();
    this.rerenderSettings();
  }

  private async performSync(mode: SyncMode): Promise<void> {
    if (this.syncing) {
      new Notice(t('SYNC_ALREADY_RUNNING'));
      return;
    }
    if (usableProfiles(this.settings).length === 0) {
      new Notice(t('SYNC_NO_PROFILES'));
      return;
    }

    this.syncing = true;
    this.cancelling = false;
    this.cancelToken = new CancelToken();
    this.progressNotice = new Notice(mode === 'force' ? t('FORCE_SYNC_STARTING') : t('SYNC_STARTING'), 0);
    this.lastProgressAt = 0;
    this.rerenderSettings();

    const reporter: SyncReporter = {
      status: message => this.setProgress(message, true),
      progress: (account, processed, total) => {
        this.setProgress(t('PROGRESS_WRITING', { account, i: processed, n: total }));
      },
    };

    let result: EngineResult | null = null;
    try {
      result = await runSync({
        settings: this.settings,
        state: this.state,
        notes: this.notes,
        dailies: this.dailies,
        attachments: this.attachments,
        ai: this.ai,
        reporter,
        apiFor: profile => new MemosHttpApi(
          profile.apiUrl,
          profile.apiToken,
          profile.memosApiMode ?? this.settings.memosApiMode,
        ),
      }, mode, this.cancelToken);
      this.reportResult(mode, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const prefix = mode === 'force' ? t('FORCE_SYNC_FAILED') : t('SYNC_FAILED');
      new Notice(`${prefix}: ${message}`, 10000);
    } finally {
      this.progressNotice?.hide();
      this.progressNotice = null;
      this.syncing = false;
      this.cancelling = false;
      this.cancelToken = null;
      this.rerenderSettings();
    }
  }

  private reportResult(mode: SyncMode, result: EngineResult): void {
    if (result.cancelled) {
      new Notice(t('SYNC_CANCELLED'), 6000);
      return;
    }
    if (result.failures.length === 0) {
      new Notice(mode === 'force' ? t('FORCE_SYNC_SUCCESS') : t('SYNC_SUCCESS'));
      return;
    }
    const first = result.failures[0];
    new Notice(t('SYNC_PARTIAL_BASE', {
      succeeded: result.succeeded,
      n: result.failures.length,
      more: result.failures.length > 1 ? t('SYNC_PARTIAL_MORE', { n: result.failures.length }) : '',
      name: first.name || first.profileId,
      message: first.message,
    }), 10000);
  }

  private setProgress(message: string, force = false): void {
    if (!this.progressNotice) return;
    const now = Date.now();
    if (!force && now - this.lastProgressAt < 400) return;
    this.lastProgressAt = now;
    this.progressNotice.setMessage(message);
  }

  private scheduleStartupSync(): void {
    if (this.startupTimer !== null) window.clearTimeout(this.startupTimer);
    this.startupTimer = null;
    if (!this.settings.enableAutoSyncOnStartup) return;
    if (this.settings.skipIfSyncedToday && syncedToday(this.settings)) return;
    const delay = Math.max(0, this.settings.startupSyncDelay) * 1000;
    this.startupTimer = window.setTimeout(() => {
      this.startupTimer = null;
      void this.performSync('smart');
    }, delay);
  }

  private schedulePeriodicSync(): void {
    if (this.periodicTimer !== null) {
      window.clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    const minutes = this.settings.periodicSyncInterval;
    if (minutes > 0) {
      this.periodicTimer = window.setInterval(() => {
        void this.performSync('smart');
      }, minutes * 60000);
    }
  }

  // ------------------------------------------------------------------ send

  private openQuickCapture(): void {
    const profiles = usableProfiles(this.settings);
    if (profiles.length === 0) {
      new Notice(t('NOTICE_NO_ACCOUNT'));
      return;
    }
    new QuickCaptureModal(this.app, profiles, (content, visibility, profile) =>
      this.sendContent(content, visibility, profile)).open();
  }

  private async pickProfile(): Promise<MemosProfile | null> {
    const profiles = usableProfiles(this.settings);
    if (profiles.length === 0) {
      new Notice(t('NOTICE_NO_ACCOUNT'));
      return null;
    }
    if (profiles.length === 1) return resolveSendProfile(this.settings) ?? profiles[0];
    return new Promise<MemosProfile | null>(resolve => {
      new AccountPickModal(this.app, profiles, resolve).open();
    });
  }

  private async sendSelection(editor: Editor): Promise<void> {
    const selected = editor.getSelection();
    const content = selected.trim() ? selected : editor.getLine(editor.getCursor().line);
    await this.sendContent(content, 'PRIVATE');
  }

  private async sendActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t('NOTICE_NO_ACTIVE_FILE'));
      return;
    }
    await this.sendNoteFile(file);
  }

  private async sendNoteFile(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch (error) {
      new Notice(t('NOTICE_SEND_FAILED', { message: error instanceof Error ? error.message : String(error) }));
      return;
    }
    await this.sendContent(content, 'PRIVATE');
  }

  private async sendContent(
    content: string,
    visibility: string,
    profile?: MemosProfile,
  ): Promise<boolean> {
    const text = content.trim();
    if (!text) {
      new Notice(t('NOTICE_SEND_EMPTY'));
      return false;
    }
    const target = profile ?? await this.pickProfile();
    if (!target) return false;
    const account = target.name.trim() || target.id;
    try {
      await sendMemo(target, this.settings, text, visibility);
      new Notice(t('NOTICE_SENT', { account }));
      return true;
    } catch (error) {
      new Notice(t('NOTICE_SEND_FAILED', { message: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  // ------------------------------------------------------------- connection

  async testProfile(profile: MemosProfile): Promise<{ success: boolean; message: string }> {
    try {
      const api = new MemosHttpApi(
        profile.apiUrl,
        profile.apiToken,
        profile.memosApiMode ?? this.settings.memosApiMode,
      );
      await api.listMemos({ pageSize: 1 });
      return {
        success: true,
        message: t('TEST_SUCCESS', { url: profile.apiUrl, prefix: api.getPrefix() ?? '' }),
      };
    } catch (error) {
      return {
        success: false,
        message: t('TEST_FAILED', { message: error instanceof Error ? error.message : String(error) }),
      };
    }
  }

  async testAI(): Promise<{ success: boolean; message: string }> {
    const result = await this.ai.testConnection();
    return {
      success: result.success,
      message: result.success ? t('AI_TEST_SUCCESS') : result.message,
    };
  }

  fetchModels(): Promise<{ success: boolean; models: string[]; message?: string }> {
    return this.ai.listModels();
  }

  // ------------------------------------------------------------ maintenance

  conflictDirs(): string[] {
    const root = safeDir(this.settings.syncTargetDir, 'Memos');
    const dirs = new Set<string>();
    for (const path of this.app.vault.getMarkdownFiles().map(file => file.path)) {
      const dir = this.conflictDirOf(path, root);
      if (dir) dirs.add(dir);
    }
    return Array.from(dirs).sort();
  }

  private conflictDirOf(path: string, root: string): string | null {
    if (!path.startsWith(`${root}/`)) return null;
    const parts = path.split('/');
    const rootParts = root.split('/');
    for (let i = rootParts.length; i < parts.length; i++) {
      if (parts[i] !== '_冲突') continue;
      if (i - rootParts.length > 2) return null;
      return parts.slice(0, i + 1).join('/');
    }
    return null;
  }

  async openFolder(path: string): Promise<void> {
    if (!path) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const fullPath = adapter.getFullPath(path);
    if (!(await adapter.exists(path))) {
      new Notice(fullPath, 8000);
      return;
    }
    const electron = (window as unknown as {
      require?: (module: string) => { shell?: { openPath(target: string): Promise<string> } };
    }).require?.('electron');
    if (!electron?.shell) {
      new Notice(fullPath, 8000);
      return;
    }
    try {
      const failure = await electron.shell.openPath(fullPath);
      if (failure) new Notice(`${fullPath}\n${failure}`, 8000);
    } catch {
      new Notice(fullPath, 8000);
    }
  }

  async cleanBackups(days: number): Promise<number> {
    // 0 means "delete every backup"; an invalid value falls back to 30 days
    // instead of being treated as 0, which would wipe all backups.
    const retention = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 30;
    const threshold = retention === 0 ? Number.POSITIVE_INFINITY : Date.now() - retention * 86400000;
    const root = safeDir(this.settings.syncTargetDir, 'Memos');
    let removed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.conflictDirOf(file.path, root)) continue;
      if (file.stat.mtime >= threshold) continue;
      try {
        await this.app.fileManager.trashFile(file);
        removed++;
      } catch (error) {
        // One locked file must not abort the whole cleanup.
        console.warn('[Memos Hub] failed to trash backup:', error instanceof Error ? error.message : String(error));
      }
    }
    return removed;
  }

  async clearIgnored(): Promise<void> {
    this.settings.ignoredMemoIds = {};
    // Forget what used to be on disk as well, otherwise the next sync would
    // treat every deleted note as deleted again and never recreate it.
    this.settings.knownMemoIds = {};
    await this.saveSettings();
    new Notice(t('IGNORE_CLEARED'));
    this.rerenderSettings();
  }
}
