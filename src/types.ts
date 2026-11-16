/** Shared value types for Memos Hub. */

export type StorageMode = 'file' | 'dailyNote';
export type FolderDepth = 'flat' | 'year' | 'yearMonth';
export type MemosApiMode = 'auto' | 'api' | 'api-v1';
export type AIProvider = 'lmstudio' | 'deepseek' | 'openai' | 'custom';
export type SyncMode = 'smart' | 'incremental' | 'force';
export type Visibility = 'PRIVATE' | 'PROTECTED' | 'PUBLIC';

export interface MemosProfile {
  id: string;
  name: string;
  apiUrl: string;
  apiToken: string;
  dailyMemoHeader: string;
  syncDaysLimit: number;
  enabled: boolean;
  memosApiMode?: MemosApiMode;
}

export interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  customModelName: string;
  autoTags: boolean;
  autoSummary: boolean;
  promptTemplate: string;
}

/** An account whose sync failed in the most recent run. */
export interface SyncFailureInfo {
  profileId: string;
  name: string;
  message: string;
}

export interface MemosSettings {
  profiles: MemosProfile[];
  /** Profile that receives content from the "send to Memos" commands. */
  defaultProfileId: string;

  storageMode: StorageMode;
  syncTargetDir: string;
  dailyMemoHeader: string;
  memosApiMode: MemosApiMode;

  folderDepth: FolderDepth;
  fileNameFormat: string;
  useFrontmatter: boolean;
  handleDeletedMemos: boolean;

  includeTags: string;
  excludeTags: string;
  skipArchivedMemos: boolean;
  /** Keep daily blocks of archived memos instead of dropping them on a full sync. */
  keepArchivedDailyBlocks: boolean;

  attachmentFolderPath: string;
  skipImages: boolean;
  createMissingDailyNotes: boolean;
  useCalloutFormat: boolean;
  useListCalloutFormat: boolean;

  ai: AISettings;

  enableAutoSyncOnStartup: boolean;
  startupSyncDelay: number;
  skipIfSyncedToday: boolean;
  periodicSyncInterval: number;

  lastSyncByProfile: {
    file: Record<string, string>;
    dailyNote: Record<string, string>;
  };
  /** profileId → Date#toDateString() of the last successful sync (startup skip). */
  lastSyncDateByProfile: Record<string, string>;
  /** Unix ms of the most recent run that had failures; 0 = last run was clean. */
  lastSyncFailedAt: number;
  lastSyncFailures: SyncFailureInfo[];

  /** profileId → memo ids the user deleted locally; skipped until cleared. */
  ignoredMemoIds: Record<string, string[]>;
  /** profileId → memo ids whose note existed after the last sync. */
  knownMemoIds: Record<string, string[]>;
  /** profileId → daily keys whose note lacked the header and was reported already. */
  headerMissDays: Record<string, string[]>;
}

/** Raw memo shape returned by the Memos REST API. */
export interface RawAttachment {
  id?: string | number;
  name?: string;
  filename?: string;
  type?: string;
  size?: number | string;
  externalLink?: string;
  uid?: string;
}

export interface RawMemo {
  id?: string | number;
  name?: string;
  uid?: string;
  content?: string;
  timestamp?: number;
  createdTs?: number;
  createdAt?: string;
  createTime?: string;
  updateTime?: string;
  visibility?: string;
  state?: string;
  pinned?: boolean;
  tags?: string[];
  attachments?: RawAttachment[];
  resourceList?: RawAttachment[];
  resources?: RawAttachment[];
}

export interface MemoResource {
  uid: string;
  name: string;
  filename: string;
  type: string;
  size: number;
  externalLink: string;
  localPath?: string;
}

export interface NormalizedMemo {
  uid: string;
  /** Creation time, unix seconds. */
  createdAt: number;
  /** Last change time, unix seconds; falls back to the creation time. */
  activityAt: number;
  /** Server-reported last change time; undefined when the server omits it. */
  remoteUpdatedAt?: number;
  /** Raw `updateTime` value, written to frontmatter verbatim. */
  updateTime?: string;
  content: string;
  tags: string[];
  visibility: string;
  state: string;
  pinned: boolean;
  resources: MemoResource[];
}

export interface MemosListPage {
  memos: RawMemo[];
  nextPageToken: string;
}

export interface ListMemosOptions {
  pageSize?: number;
  pageToken?: string;
  filter?: string;
}

export interface SyncResult {
  attempted: number;
  succeeded: number;
  written: number;
  failures: SyncFailureInfo[];
}
