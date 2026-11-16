/** Settings defaults, validation and small helpers. */

import type {
  AIProvider,
  AISettings,
  FolderDepth,
  MemosApiMode,
  MemosProfile,
  MemosSettings,
  StorageMode,
  SyncFailureInfo,
} from '../types';
import { DEFAULT_PROMPT } from '../domain/prompt';

export const FILE_NAME_FORMAT_DEFAULT = 'YYYY-MM-DD HH-mm-ss';
export const DAILY_HEADER_DEFAULT = '## 📓 Memos';
export const SYNC_DIR_DEFAULT = 'Memos';
export const ATTACHMENT_DIR_DEFAULT = 'Assets/MemosFiles';

const STORAGE_MODES: StorageMode[] = ['file', 'dailyNote'];
const FOLDER_DEPTHS: FolderDepth[] = ['flat', 'year', 'yearMonth'];
const API_MODES: MemosApiMode[] = ['auto', 'api', 'api-v1'];
const AI_PROVIDERS: AIProvider[] = ['lmstudio', 'deepseek', 'openai', 'custom'];

export function createDefaultAISettings(): AISettings {
  return {
    enabled: false,
    provider: 'lmstudio',
    apiBaseUrl: '',
    apiKey: '',
    modelName: '',
    customModelName: '',
    autoTags: true,
    autoSummary: false,
    promptTemplate: DEFAULT_PROMPT,
  };
}

export function createDefaultSettings(): MemosSettings {
  return {
    profiles: [],
    defaultProfileId: '',
    storageMode: 'file',
    syncTargetDir: SYNC_DIR_DEFAULT,
    dailyMemoHeader: DAILY_HEADER_DEFAULT,
    memosApiMode: 'auto',
    folderDepth: 'flat',
    fileNameFormat: FILE_NAME_FORMAT_DEFAULT,
    useFrontmatter: true,
    handleDeletedMemos: true,
    includeTags: '',
    excludeTags: '',
    skipArchivedMemos: true,
    keepArchivedDailyBlocks: false,
    attachmentFolderPath: ATTACHMENT_DIR_DEFAULT,
    skipImages: false,
    createMissingDailyNotes: true,
    useCalloutFormat: false,
    useListCalloutFormat: false,
    ai: createDefaultAISettings(),
    enableAutoSyncOnStartup: true,
    startupSyncDelay: 5,
    skipIfSyncedToday: true,
    periodicSyncInterval: 0,
    lastSyncByProfile: { file: {}, dailyNote: {} },
    lastSyncDateByProfile: {},
    lastSyncFailedAt: 0,
    lastSyncFailures: [],
    ignoredMemoIds: {},
    knownMemoIds: {},
    headerMissDays: {},
  };
}

export function generateProfileId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `p_${Date.now().toString(36)}_${random}`;
}

export function createProfile(index: number): MemosProfile {
  return {
    id: generateProfileId(),
    name: `Account ${index}`,
    apiUrl: '',
    apiToken: '',
    dailyMemoHeader: DAILY_HEADER_DEFAULT,
    syncDaysLimit: 0,
    enabled: true,
    memosApiMode: 'auto',
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberOr(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function enumOr<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function normalizeProfile(raw: unknown, index: number): MemosProfile {
  const source = isRecord(raw) ? raw : {};
  const defaults = createProfile(index + 1);
  return {
    id: stringOr(source.id, defaults.id) || defaults.id,
    name: stringOr(source.name, defaults.name),
    apiUrl: stringOr(source.apiUrl, '').trim(),
    apiToken: stringOr(source.apiToken, '').trim(),
    dailyMemoHeader: stringOr(source.dailyMemoHeader, defaults.dailyMemoHeader),
    syncDaysLimit: Math.floor(numberOr(source.syncDaysLimit, defaults.syncDaysLimit, 0, 36500)),
    enabled: boolOr(source.enabled, defaults.enabled),
    memosApiMode: enumOr(source.memosApiMode, API_MODES, defaults.memosApiMode ?? 'auto'),
  };
}

function normalizeAISettings(raw: unknown): AISettings {
  const source = isRecord(raw) ? raw : {};
  const defaults = createDefaultAISettings();
  return {
    enabled: boolOr(source.enabled, defaults.enabled),
    provider: enumOr(source.provider, AI_PROVIDERS, defaults.provider),
    apiBaseUrl: stringOr(source.apiBaseUrl, defaults.apiBaseUrl).trim(),
    apiKey: stringOr(source.apiKey, defaults.apiKey),
    modelName: stringOr(source.modelName, defaults.modelName).trim(),
    customModelName: stringOr(source.customModelName, defaults.customModelName).trim(),
    autoTags: boolOr(source.autoTags, defaults.autoTags),
    autoSummary: boolOr(source.autoSummary, defaults.autoSummary),
    promptTemplate: (() => {
      const value = stringOr(source.promptTemplate, defaults.promptTemplate);
      return value.trim() ? value : DEFAULT_PROMPT;
    })(),
  };
}

function normalizeCursorMap(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value);
  }
  return out;
}

function normalizeStringArrayMap(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
  return out;
}

function normalizeFailures(raw: unknown): SyncFailureInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncFailureInfo[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.profileId !== 'string') continue;
    out.push({
      profileId: item.profileId,
      name: stringOr(item.name, ''),
      message: stringOr(item.message, ''),
    });
  }
  return out;
}

/**
 * Fill in missing or invalid fields. Idempotent: running it twice yields the
 * same object, and unknown keys (e.g. the old `separateProfileFolders`) are
 * dropped instead of being persisted.
 */
export function normalizeSettings(raw: unknown): MemosSettings {
  const defaults = createDefaultSettings();
  const source = isRecord(raw) ? raw : {};

  const profiles = Array.isArray(source.profiles)
    ? source.profiles.map((profile, index) => normalizeProfile(profile, index))
    : [];

  const cursorSource = isRecord(source.lastSyncByProfile) ? source.lastSyncByProfile : {};
  const dateSource = isRecord(source.lastSyncDateByProfile) ? source.lastSyncDateByProfile : {};
  const lastSyncDateByProfile: Record<string, string> = {};
  for (const [key, value] of Object.entries(dateSource)) {
    if (typeof value === 'string') lastSyncDateByProfile[key] = value;
  }

  const useCalloutFormat = boolOr(source.useCalloutFormat, defaults.useCalloutFormat);
  const useListCalloutFormat = useCalloutFormat
    ? false
    : boolOr(source.useListCalloutFormat, defaults.useListCalloutFormat);

  const defaultProfileId = profiles.some(profile => profile.id === source.defaultProfileId)
    ? String(source.defaultProfileId)
    : '';

  return {
    profiles,
    defaultProfileId,
    storageMode: enumOr(source.storageMode, STORAGE_MODES, defaults.storageMode),
    syncTargetDir: stringOr(source.syncTargetDir, defaults.syncTargetDir),
    dailyMemoHeader: stringOr(source.dailyMemoHeader, defaults.dailyMemoHeader) || DAILY_HEADER_DEFAULT,
    memosApiMode: enumOr(source.memosApiMode, API_MODES, defaults.memosApiMode),
    folderDepth: enumOr(source.folderDepth, FOLDER_DEPTHS, defaults.folderDepth),
    fileNameFormat: stringOr(source.fileNameFormat, defaults.fileNameFormat) || FILE_NAME_FORMAT_DEFAULT,
    useFrontmatter: boolOr(source.useFrontmatter, defaults.useFrontmatter),
    handleDeletedMemos: boolOr(source.handleDeletedMemos, defaults.handleDeletedMemos),
    includeTags: stringOr(source.includeTags, defaults.includeTags),
    excludeTags: stringOr(source.excludeTags, defaults.excludeTags),
    skipArchivedMemos: boolOr(source.skipArchivedMemos, defaults.skipArchivedMemos),
    keepArchivedDailyBlocks: boolOr(source.keepArchivedDailyBlocks, defaults.keepArchivedDailyBlocks),
    attachmentFolderPath: stringOr(source.attachmentFolderPath, defaults.attachmentFolderPath),
    skipImages: boolOr(source.skipImages, defaults.skipImages),
    createMissingDailyNotes: boolOr(source.createMissingDailyNotes, defaults.createMissingDailyNotes),
    useCalloutFormat,
    useListCalloutFormat,
    ai: normalizeAISettings(source.ai),
    enableAutoSyncOnStartup: boolOr(source.enableAutoSyncOnStartup, defaults.enableAutoSyncOnStartup),
    startupSyncDelay: Math.floor(numberOr(source.startupSyncDelay, defaults.startupSyncDelay, 0, 3600)),
    skipIfSyncedToday: boolOr(source.skipIfSyncedToday, defaults.skipIfSyncedToday),
    periodicSyncInterval: Math.floor(numberOr(source.periodicSyncInterval, defaults.periodicSyncInterval, 0, 1440)),
    lastSyncByProfile: {
      file: normalizeCursorMap(cursorSource.file),
      dailyNote: normalizeCursorMap(cursorSource.dailyNote),
    },
    lastSyncDateByProfile,
    lastSyncFailedAt: Math.floor(numberOr(source.lastSyncFailedAt, defaults.lastSyncFailedAt, 0)),
    lastSyncFailures: normalizeFailures(source.lastSyncFailures),
    ignoredMemoIds: normalizeStringArrayMap(source.ignoredMemoIds),
    knownMemoIds: normalizeStringArrayMap(source.knownMemoIds),
    headerMissDays: normalizeStringArrayMap(source.headerMissDays),
  };
}

export function enabledProfiles(settings: MemosSettings): MemosProfile[] {
  return settings.profiles.filter(profile => profile.enabled);
}

export function isProfileConfigured(profile: MemosProfile): boolean {
  return Boolean(profile.apiUrl.trim() && profile.apiToken.trim());
}

/** Profile that receives send commands; falls back to the first usable account. */
export function resolveSendProfile(settings: MemosSettings): MemosProfile | null {
  const usable = enabledProfiles(settings).filter(isProfileConfigured);
  if (usable.length === 0) return null;
  return usable.find(profile => profile.id === settings.defaultProfileId) ?? usable[0];
}

export function isOnlyAccount(settings: MemosSettings, profileId: string): boolean {
  return settings.profiles.filter(profile => profile.id !== profileId).length === 0;
}
