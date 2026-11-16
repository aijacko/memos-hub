/** Vault implementation of the attachment store. */

import { App, TFile } from 'obsidian';
import type { AttachmentStorePort } from '../ports';
import { parentDir } from '../domain/paths';

export class VaultAttachmentStore implements AttachmentStorePort {
  constructor(private app: App) {}

  exists(path: string): boolean {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile;
  }

  async save(path: string, bytes: ArrayBuffer): Promise<void> {
    const folder = parentDir(path);
    if (folder) await this.ensureFolder(folder);
    if (this.exists(path)) return;
    await this.app.vault.createBinary(path, bytes);
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}
