/** AI provider calls (OpenAI-compatible chat completions). */

import { requestUrl } from 'obsidian';
import type { AISettings, AIProvider } from '../types';
import { buildDefaultPrompt, isDefaultPrompt } from '../domain/prompt';
import { getLanguage, t } from '../i18n/t';
import { errorMessage, withTimeout } from './http';

const REQUEST_TIMEOUT_MS = 60000;
const MIN_CONTENT_LENGTH = 20;
const CACHE_LIMIT = 300;
/** After one failed call, skip AI for a minute so an offline endpoint cannot stall a whole sync. */
const FAILURE_COOLDOWN_MS = 60000;

const PROVIDER_BASE: Record<AIProvider, string> = {
  lmstudio: 'http://localhost:1234',
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com',
  custom: '',
};

function baseUrlFor(settings: AISettings): string {
  let base = settings.provider === 'custom'
    ? settings.apiBaseUrl
    : (settings.apiBaseUrl.trim() || PROVIDER_BASE[settings.provider]);
  base = (base ?? '').trim().replace(/\/+$/, '');
  if (base && !/\/v\d+$/.test(base) && !base.includes('/v1/')) base = `${base}/v1`;
  return base;
}

export function resolveModelName(settings: AISettings): string {
  if (settings.modelName === 'custom') return settings.customModelName || '';
  return settings.modelName;
}

export class AIService {
  private readonly cache = new Map<string, string>();
  private cooldownUntil = 0;

  constructor(private readonly getSettings: () => AISettings) {}

  private get settings(): AISettings {
    return this.getSettings();
  }

  async listModels(): Promise<{ success: boolean; models: string[]; message?: string }> {
    const base = baseUrlFor(this.settings);
    if (!base) return { success: false, models: [], message: t('AI_INVALID_CONFIG') };

    try {
      const response = await withTimeout(
        requestUrl({
          url: `${base}/models`,
          method: 'GET',
          headers: { Authorization: `Bearer ${this.settings.apiKey}` },
          throw: false,
        }),
        15000,
        t('API_TIMEOUT', { seconds: 15 }),
      );
      if (response.status >= 200 && response.status < 300) {
        const data = response.json as {
          data?: Array<{ id?: string }>;
          models?: Array<{ id?: string }>;
        };
        const models = (data?.data ?? data?.models ?? [])
          .map(item => item.id)
          .filter((id): id is string => Boolean(id));
        return models.length > 0
          ? { success: true, models }
          : { success: false, models: [], message: t('AI_NO_MODELS') };
      }
      return { success: false, models: [], message: `HTTP ${response.status}` };
    } catch (error) {
      return { success: false, models: [], message: errorMessage(error) };
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.settings.enabled) return { success: false, message: t('AI_NOT_ENABLED') };
    const base = baseUrlFor(this.settings);
    if (!base) return { success: false, message: t('AI_INVALID_CONFIG') };
    const model = resolveModelName(this.settings);
    if (!model) return { success: false, message: t('AI_NO_MODEL') };

    try {
      const response = await withTimeout(
        requestUrl({
          url: `${base}/chat/completions`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.settings.apiKey}`,
          },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }] }),
          throw: false,
        }),
        REQUEST_TIMEOUT_MS,
        t('API_TIMEOUT', { seconds: REQUEST_TIMEOUT_MS / 1000 }),
      );
      if (response.status >= 200 && response.status < 300) {
        return { success: true, message: t('AI_CONNECTION_OK') };
      }
      let message = `HTTP ${response.status}`;
      try {
        const data = JSON.parse(response.text ?? '') as { error?: { message?: string } };
        if (data.error?.message) message += `: ${data.error.message}`;
      } catch {
        // Keep the status-only message.
      }
      return { success: false, message };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  }

  /** Rewrite one memo body; returns the input unchanged on any failure. */
  async clean(content: string): Promise<string> {
    if (!this.settings.enabled || !content.trim()) return content;
    if (Date.now() < this.cooldownUntil) return content;
    const plain = content.replace(/[#*`>[\]]/g, '').trim();
    if (plain.length < MIN_CONTENT_LENGTH) return content;

    const base = baseUrlFor(this.settings);
    const model = resolveModelName(this.settings);
    if (!base || !model) return content;

    const template = this.settings.promptTemplate ?? '';
    const useDefault = isDefaultPrompt(template);

    let systemPrompt: string;
    let userMessage: string;
    if (useDefault) {
      systemPrompt = buildDefaultPrompt(this.settings.autoTags, this.settings.autoSummary, getLanguage());
      userMessage = content;
    } else if (/\{\{content\}\}/.test(template)) {
      systemPrompt = template.replace(/\{\{content\}\}/g, content);
      userMessage = t('AI_CLEAN_INSTRUCTION');
    } else {
      systemPrompt = template;
      userMessage = content;
    }

    const cacheKey = `${model}\u0000${systemPrompt}\u0000${userMessage}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const response = await withTimeout(
        requestUrl({
          url: `${base}/chat/completions`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.settings.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
          }),
          throw: false,
        }),
        REQUEST_TIMEOUT_MS,
        t('API_TIMEOUT', { seconds: REQUEST_TIMEOUT_MS / 1000 }),
      );
      if (response.status >= 200 && response.status < 300) {
        const data = response.json as { choices?: Array<{ message?: { content?: string } }> };
        const result = data?.choices?.[0]?.message?.content?.trim();
        if (result) {
          if (this.cache.size >= CACHE_LIMIT) {
            const first = this.cache.keys().next();
            if (!first.done) this.cache.delete(first.value);
          }
          this.cache.set(cacheKey, result);
          return result;
        }
      }
    } catch (error) {
      this.cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
      console.warn('[Memos Hub] AI request failed:', errorMessage(error));
    }
    return content;
  }
}
