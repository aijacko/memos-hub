/** Send one memo to a Memos account. */

import { MemosHttpApi } from '../adapters/memosHttp';
import type { MemosProfile, MemosSettings } from '../types';

export async function sendMemo(
  profile: MemosProfile,
  settings: MemosSettings,
  content: string,
  visibility: string,
): Promise<void> {
  const api = new MemosHttpApi(
    profile.apiUrl,
    profile.apiToken,
    profile.memosApiMode ?? settings.memosApiMode,
  );
  await api.createMemo(content, visibility);
}
