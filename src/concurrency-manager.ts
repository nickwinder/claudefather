/**
 * Simple semaphore for controlling concurrency
 * Limits number of concurrent operations
 */
export class ConcurrencyManager {
  private activeCount: number = 0;
  private maxConcurrency: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrency: number = 3) {
    this.maxConcurrency = Math.max(1, maxConcurrency); // At least 1
  }

  /**
   * Wait for a slot to become available
   * Returns a release function to call when done
   */
  async acquire(): Promise<() => void> {
    while (this.activeCount >= this.maxConcurrency) {
      // Wait for a slot to become available
      await new Promise<void>((resolve) => {
        this.queue.push(() => resolve());
      });
    }

    this.activeCount++;

    return () => {
      this.activeCount--;
      const waiter = this.queue.shift();
      if (waiter) {
        waiter();
      }
    };
  }

  /**
   * Run a function with automatic concurrency management
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Get current concurrency level
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Get max concurrency
   */
  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }
}
