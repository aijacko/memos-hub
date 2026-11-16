/** Cancellation token shared by every sync stage. */

export class CancelToken {
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }
}

/** Progress sink used by the sync engines; implemented by the Notice in the UI. */
export interface SyncReporter {
  status(message: string): void;
  progress(account: string, processed: number, total: number): void;
}
