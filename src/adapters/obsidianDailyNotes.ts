/** Daily-notes implementation backed by obsidian-daily-notes-interface. */

import { App, TFile, moment } from 'obsidian';
import { createDailyNote, getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface';
import type { DailyNoteStorePort } from '../ports';

export class ObsidianDailyNotes implements DailyNoteStorePort {
  constructor(private app: App) {}

  find(date: string): string | null {
    const day = moment(date, 'YYYY-MM-DD');
    if (!day.isValid()) return null;
    const note = getDailyNote(day, getAllDailyNotes());
    // The library bundles its own obsidian.d.ts, so narrow with instanceof.
    return note instanceof TFile ? note.path : null;
  }

  async create(date: string): Promise<string | null> {
    const day = moment(date, 'YYYY-MM-DD');
    if (!day.isValid()) return null;
    const note = await createDailyNote(day);
    return note instanceof TFile ? note.path : null;
  }

  async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return this.app.vault.read(file);
  }

  async write(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    await this.app.vault.modify(file, content);
  }
}
