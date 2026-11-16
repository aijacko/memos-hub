/** Outbound ports used by the sync features. */

import type { ListMemosOptions, MemosListPage } from '../types';

export interface MemosApiPort {
  listMemos(options: ListMemosOptions): Promise<MemosListPage>;
  createMemo(content: string, visibility: string): Promise<void>;
  /** Prefix negotiated so far, e.g. `/api`; null before the first request. */
  getPrefix(): string | null;
}

export interface NoteStorePort {
  exists(path: string): boolean;
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  modify(path: string, content: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
  /** Markdown files under `root`, skipping the given folder names. */
  listMarkdown(root: string, maxDepth: number, skipNames: string[]): Promise<string[]>;
  /** Last modification time, unix ms. */
  mtime(path: string): number;
  trash(path: string): Promise<void>;
}

export interface DailyNoteStorePort {
  /** Path of an existing daily note for `YYYY-MM-DD`, or null. */
  find(date: string): string | null;
  create(date: string): Promise<string | null>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface AttachmentStorePort {
  /** Whether the attachment file already exists in the vault. */
  exists(name: string): boolean;
  save(name: string, bytes: ArrayBuffer): Promise<void>;
}

export interface AICleanerPort {
  clean(content: string): Promise<string>;
}
