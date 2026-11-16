/** Vault implementation of the note store. */

import { App, TFile, TFolder } from 'obsidian';
import type { NoteStorePort } from '../ports';

export class VaultNoteStore implements NoteStorePort {
  constructor(private app: App) {}

  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return this.app.vault.read(file);
  }

  async create(path: string, content: string): Promise<void> {
    await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
    await this.app.vault.create(path, content);
  }

  async modify(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    await this.app.vault.modify(file, content);
  }

  async copy(from: string, to: string): Promise<void> {
    const source = this.app.vault.getAbstractFileByPath(from);
    if (!(source instanceof TFile)) throw new Error(`File not found: ${from}`);
    await this.ensureFolder(to.split('/').slice(0, -1).join('/'));
    await this.app.vault.copy(source, to);
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.app.vault.getAbstractFileByPath(from);
    if (!(source instanceof TFile)) throw new Error(`File not found: ${from}`);
    await this.ensureFolder(to.split('/').slice(0, -1).join('/'));
    await this.app.vault.rename(source, to);
  }

  async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`Not a folder: ${current}`);
      await this.app.vault.createFolder(current);
    }
  }

  async listMarkdown(root: string, maxDepth: number, skipNames: string[]): Promise<string[]> {
    const entry = this.app.vault.getAbstractFileByPath(root);
    if (!(entry instanceof TFolder)) return [];
    const files: string[] = [];
    const skip = new Set(skipNames);
    const visit = (folder: TFolder, depth: number) => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === 'md') {
          files.push(child.path);
        } else if (child instanceof TFolder) {
          if (skip.has(child.name) || depth >= maxDepth) continue;
          visit(child, depth + 1);
        }
      }
    };
    visit(entry, 0);
    return files;
  }

  mtime(path: string): number {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file.stat.mtime : 0;
  }

  async trash(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.fileManager.trashFile(file);
  }
}
