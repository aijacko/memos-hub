/** Raw binary download for one Memos attachment (30s timeout). */

import { requestUrl } from 'obsidian';
import { withTimeout } from './http';

const DOWNLOAD_TIMEOUT_MS = 30000;

function looksLikeHtml(buffer: ArrayBuffer): boolean {
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(200, buffer.byteLength)));
  return /<html|<body|<head/i.test(head);
}

function isUsable(buffer: ArrayBuffer | undefined): buffer is ArrayBuffer {
  if (!buffer || buffer.byteLength <= 100) return false;
  if (buffer.byteLength < 2000 && looksLikeHtml(buffer)) return false;
  return true;
}

/** `attachments/uid` or a bare uid for one resource. */
export interface AttachmentFetchTarget {
  name: string;
  filename: string;
  uid: string;
  prefix: string | null;
}

/**
 * Try every known download URL until real binary data comes back.
 * Returns null when the file cannot be fetched; callers degrade to a link.
 */
export async function fetchAttachmentBinary(
  baseUrl: string,
  token: string,
  target: AttachmentFetchTarget,
): Promise<ArrayBuffer | null> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const candidates: string[] = [];
  // Server-supplied names must not walk up the API path.
  const name = target.name && !target.name.split('/').includes('..') ? target.name : '';

  if (name.startsWith('attachments/')) {
    candidates.push(`${base}/file/${name}`);
    if (target.filename) {
      candidates.push(`${base}/file/${name}/${encodeURIComponent(target.filename)}`);
    }
  }
  if (target.uid) candidates.push(`${base}/file/attachments/${target.uid}`);
  if (name) candidates.push(`${base}/${name}`);

  for (const url of candidates) {
    try {
      const response = await withTimeout(
        requestUrl({ url, method: 'GET', headers, throw: false }),
        DOWNLOAD_TIMEOUT_MS,
        'Attachment download timed out',
      );
      if (response.status >= 200 && response.status < 300 && isUsable(response.arrayBuffer)) {
        return response.arrayBuffer;
      }
    } catch {
      // Try the next candidate.
    }
  }

  // Legacy servers returned the file as base64 in the JSON resource object.
  if (name) {
    const prefixes = target.prefix ? [target.prefix] : ['/api/v1', '/api'];
    for (const prefix of prefixes) {
      try {
        const response = await withTimeout(
          requestUrl({
            url: `${base}${prefix}/${name}`,
            method: 'GET',
            headers: { ...headers, Accept: 'application/json' },
            throw: false,
          }),
          DOWNLOAD_TIMEOUT_MS,
          'Attachment download timed out',
        );
        if (response.status >= 200 && response.status < 300) {
          const data = response.json as { content?: string } | undefined;
          if (data?.content) {
            const raw = atob(data.content);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            if (bytes.length > 0) return bytes.buffer;
          }
        }
      } catch {
        // Ignore and try the next prefix.
      }
    }
  }

  return null;
}
