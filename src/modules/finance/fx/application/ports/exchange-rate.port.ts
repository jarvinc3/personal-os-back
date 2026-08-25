export type ExchangeRateResult =
  | { ok: true; rate: number; source: 'api' | 'cache' | 'identity' }
  | { ok: false; code: 'RATE_UNAVAILABLE' | 'PROVIDER_ERROR'; message: string; retryable: boolean };

export interface ExchangeRatePort {
  getHistoricalRate(params: {
    from: string;
    to: string;
    date: string; // YYYY-MM-DD
  }): Promise<ExchangeRateResult>;
}
