/** Minimal Obsidian API stand-in so pure modules can run under node. */

export const moment = {
  locale: (): string => 'zh',
};

export class Notice {
  constructor(public message?: string, public timeout?: number) {}

  setMessage(message: string): this {
    this.message = message;
    return this;
  }

  hide(): void {
    // no-op
  }
}

export async function requestUrl(params: unknown): Promise<unknown> {
  const hook = (globalThis as { __memosRequestUrl?: (value: unknown) => Promise<unknown> })
    .__memosRequestUrl;
  if (hook) return hook(params);
  throw new Error('requestUrl is not available in unit tests');
}
