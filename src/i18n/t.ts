/** Language selection and interpolation. */

import { moment } from 'obsidian';
import type { TranslationKey, TranslationParams } from './types';
import { zh } from './zh';
import { en } from './en';

let dictionary: Record<TranslationKey, string> = zh;

function detectLanguage(): void {
  let locale = '';
  try {
    locale = moment.locale();
  } catch {
    locale = '';
  }
  if (!locale) {
    locale = typeof navigator !== 'undefined' ? navigator.language : 'en';
  }
  const lowered = locale.toLowerCase();
  // Only Chinese has a translation; every other language falls back to English.
  dictionary = lowered.startsWith('zh') ? zh : en;
}

/** Pick the dictionary from the current Obsidian locale. */
export function initLanguage(): void {
  detectLanguage();
}

export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = dictionary[key] ?? zh[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Display name of an account, never empty. */
export function profileName(name: string, fallback: TranslationKey = 'UNNAMED_PROFILE'): string {
  const trimmed = (name ?? '').trim();
  return trimmed || t(fallback);
}
