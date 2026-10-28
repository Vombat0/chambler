export interface ReconnectPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class ReconnectPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  private attempt = 0;

  constructor(opts: ReconnectPolicyOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
  }

  get attempts(): number {
    return this.attempt;
  }

  canRetry(): boolean {
    return this.attempt < this.maxAttempts;
  }

  nextDelayMs(): number {
    const delay = Math.min(this.baseDelayMs * 2 ** this.attempt, this.maxDelayMs);
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }
}
