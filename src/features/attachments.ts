/** Attachment download and local-path assignment. */

import type { AttachmentStorePort } from '../ports';
import type { MemoResource, MemosProfile } from '../types';
import { fetchAttachmentBinary } from '../adapters/attachmentFetch';
import { safeDir, safeSegment } from '../domain/paths';
import { isProfileConfigured } from '../state/settings';

export class AttachmentService {
  constructor(
    private readonly store: AttachmentStorePort,
    private readonly getFolder: () => string,
    private readonly getSkipImages: () => boolean,
  ) {}

  private get folder(): string {
    return safeDir(this.getFolder(), 'Assets/MemosFiles');
  }

  /** `{uid}-{filename}` keeps two same-named attachments apart. */
  localPath(resource: MemoResource): string {
    const suffix = safeSegment(resource.filename || 'file', 'file');
    return `${this.folder}/${safeSegment(resource.uid, 'x')}-${suffix}`;
  }

  isImage(resource: MemoResource): boolean {
    return resource.type.toLowerCase().startsWith('image/');
  }

  /** Sets `resource.localPath` when the file is (or becomes) available. */
  async ensure(resource: MemoResource, profile: MemosProfile, prefix: string | null): Promise<void> {
    resource.localPath = undefined;
    if (this.getSkipImages() && this.isImage(resource)) return;

    const path = this.localPath(resource);
    if (this.store.exists(path)) {
      resource.localPath = path;
      return;
    }
    if (resource.externalLink || !isProfileConfigured(profile)) {
      if (resource.externalLink) resource.localPath = undefined;
      return;
    }

    const bytes = await fetchAttachmentBinary(profile.apiUrl, profile.apiToken, {
      name: resource.name,
      filename: resource.filename,
      uid: resource.uid,
      prefix,
    });
    if (!bytes) return;

    await this.store.save(path, bytes);
    resource.localPath = path;
  }

  /** Local path if present on disk, without a network round trip. */
  existing(resource: MemoResource): string | null {
    const path = this.localPath(resource);
    return this.store.exists(path) ? path : null;
  }
}
