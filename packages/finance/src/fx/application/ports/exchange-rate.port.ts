export type ExchangeRateResult =
  | { ok: true; rate: number; source: 'api' | 'cache' | 'identity' }
  | {
      ok: false;
      code: 'RATE_UNAVAILABLE' | 'PROVIDER_ERROR';
      message: string;
      retryable: boolean;
    };

export interface ExchangeRatePort {
  getHistoricalRate(params: {
    from: string;
    to: string;
    date: string; // YYYY-MM-DD
  }): Promise<ExchangeRateResult>;
  /** Latest cached rate on or before `date`, for display when the exact day has none. */
  getLatestRateOnOrBefore(params: {
    from: string;
    to: string;
    date: string; // YYYY-MM-DD
  }): Promise<ExchangeRateResult>;
  listCurrencies(): Promise<string[]>;
}
