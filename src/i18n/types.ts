/** Translation key typing: the zh dictionary is the source of truth. */

import { zh } from './zh';

export type TranslationKey = keyof typeof zh;
export type TranslationParams = Record<string, string | number>;
