/** HTTP implementation of the Memos REST API. */

import { requestUrl, type RequestUrlResponse } from 'obsidian';
import type { MemosApiPort } from '../ports';
import type { ListMemosOptions, MemosApiMode, MemosListPage, RawMemo } from '../types';
import { t } from '../i18n/t';
import { errorMessage, withTimeout } from './http';

const REQUEST_TIMEOUT_MS = 30000;
const NEW_PREFIX = '/api';
const LEGACY_PREFIX = '/api/v1';

interface ListResponse {
  memos?: RawMemo[];
  nextPageToken?: string;
  next_page_token?: string;
}

function rfc3339(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** CEL window for the memo creation time. */
export function createdTsFilter(timestamp: number): string {
  return timestamp > 0 ? `created_ts > timestamp("${rfc3339(timestamp)}")` : '';
}

/** CEL window for the last-change time (Memos 26.x). */
export function updatedTsFilter(timestamp: number): string {
  return timestamp > 0 ? `updated_ts > timestamp("${rfc3339(timestamp)}")` : '';
}

class EndpointMissingError extends Error {}

export class MemosHttpApi implements MemosApiPort {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly candidates: string[];
  private prefix: string | null = null;

  constructor(baseUrl: string, token: string, mode: MemosApiMode = 'auto') {
    const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error(t('API_URL_INVALID'));
    }
    this.baseUrl = trimmed;
    this.token = token;
    this.candidates = mode === 'api'
      ? [NEW_PREFIX]
      : mode === 'api-v1'
        ? [LEGACY_PREFIX]
        : [NEW_PREFIX, LEGACY_PREFIX];
  }

  getPrefix(): string | null {
    return this.prefix;
  }

  async listMemos(options: ListMemosOptions = {}): Promise<MemosListPage> {
    const prefixes = this.prefix ? [this.prefix] : this.candidates;
    let lastError: Error | null = null;
    for (const prefix of prefixes) {
      try {
        const page = await this.requestPage(prefix, options);
        this.prefix = prefix;
        return page;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Auth problems and filter errors are never fixed by another path.
        if (!(error instanceof EndpointMissingError)) break;
      }
    }
    throw lastError ?? new Error(`${t('FETCH_MEMOS_ERROR')}: ${this.baseUrl}`);
  }

  async createMemo(content: string, visibility: string): Promise<void> {
    const prefixes = this.prefix ? [this.prefix] : this.candidates;
    let lastError: Error | null = null;
    for (const prefix of prefixes) {
      const url = `${this.baseUrl}${prefix}/memos`;
      let response: RequestUrlResponse;
      try {
        response = await withTimeout(
          requestUrl({
            url,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ content, visibility }),
            throw: false,
          }),
          REQUEST_TIMEOUT_MS,
          t('API_TIMEOUT', { seconds: REQUEST_TIMEOUT_MS / 1000 }),
        );
      } catch (error) {
        throw new Error(t('NETWORK_ERROR', { url, message: errorMessage(error) }));
      }

      if (response.status >= 200 && response.status < 300) {
        this.prefix = prefix;
        return;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(t('API_TOKEN_INVALID'));
      }
      if (response.status === 404 || response.status === 410) {
        lastError = new Error(`HTTP ${response.status} (${url})`);
        continue;
      }
      throw this.httpError(response.status, response.text ?? '', url);
    }
    throw lastError ?? new Error(`HTTP error: ${this.baseUrl}`);
  }

  private async requestPage(prefix: string, options: ListMemosOptions): Promise<MemosListPage> {
    const params = new URLSearchParams();
    params.set('pageSize', String(options.pageSize ?? 200));
    if (options.pageToken) params.set('pageToken', options.pageToken);
    if (options.filter) params.set('filter', options.filter);
    const url = `${this.baseUrl}${prefix}/memos?${params.toString()}`;

    let response: RequestUrlResponse;
    try {
      response = await withTimeout(
        requestUrl({
          url,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
          },
          throw: false,
        }),
        REQUEST_TIMEOUT_MS,
        t('API_TIMEOUT', { seconds: REQUEST_TIMEOUT_MS / 1000 }),
      );
    } catch (error) {
      throw new Error(t('NETWORK_ERROR', { url, message: errorMessage(error) }));
    }

    if (response.status >= 200 && response.status < 300) {
      let data: ListResponse;
      try {
        data = (response.json ?? {}) as ListResponse;
      } catch {
        // A web-server SPA fallback answers unknown API paths with HTML.
        throw new EndpointMissingError(this.httpError(response.status, '', url).message);
      }
      return {
        memos: Array.isArray(data.memos) ? data.memos : [],
        nextPageToken: data.nextPageToken ?? data.next_page_token ?? '',
      };
    }

    if (response.status === 404) {
      throw new EndpointMissingError(this.httpError(response.status, response.text ?? '', url).message);
    }
    if (response.status === 410) {
      throw new EndpointMissingError(t('API_410', { url: this.baseUrl }));
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(t('API_TOKEN_INVALID'));
    }
    throw this.httpError(response.status, response.text ?? '', url);
  }

  private httpError(status: number, body: string, url: string): Error {
    const summary = body.replace(/\s+/g, ' ').trim().slice(0, 200);
    const detail = summary ? ` ${summary}${summary.length >= 200 ? '…' : ''}` : '';
    return new Error(`${t('FETCH_MEMOS_ERROR')}: HTTP ${status}${detail} (${url})`);
  }
}
