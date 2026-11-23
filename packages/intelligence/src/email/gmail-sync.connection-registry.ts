/** Conexiones tomadas, en reinicio y sus temporizadores de reintento. */
export class GmailSyncConnectionRegistry {
  private readonly active: Set<string>;
  private readonly resetting = new Set<string>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();

  constructor(activeConnections: Set<string> = new Set()) {
    this.active = activeConnections;
  }

  isActive(connectionId: string): boolean {
    return this.active.has(connectionId);
  }

  hasActiveOrResetting(connectionId: string): boolean {
    return this.active.has(connectionId) || this.resetting.has(connectionId);
  }

  markActive(connectionId: string): void {
    this.active.add(connectionId);
  }

  endSync(connectionId: string): void {
    this.active.delete(connectionId);
  }

  isResetting(connectionId: string): boolean {
    return this.resetting.has(connectionId);
  }

  beginReset(connectionId: string): void {
    this.resetting.add(connectionId);
  }

  endReset(connectionId: string): void {
    this.resetting.delete(connectionId);
  }

  clearRetry(connectionId: string): void {
    const retryTimer = this.retryTimers.get(connectionId);
    if (!retryTimer) {
      return;
    }
    clearTimeout(retryTimer);
    this.retryTimers.delete(connectionId);
  }

  clearAllRetries(): void {
    for (const retryTimer of this.retryTimers.values()) {
      clearTimeout(retryTimer);
    }
    this.retryTimers.clear();
  }

  scheduleRateLimitRetry(
    connectionId: string,
    delayMs: number,
    onRetry: () => void,
  ): void {
    const previousTimer = this.retryTimers.get(connectionId);
    if (previousTimer) {
      clearTimeout(previousTimer);
    }
    const retryTimer = setTimeout(
      () => {
        this.retryTimers.delete(connectionId);
        onRetry();
      },
      Math.max(0, delayMs),
    );
    retryTimer.unref();
    this.retryTimers.set(connectionId, retryTimer);
  }
}
