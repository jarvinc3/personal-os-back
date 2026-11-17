export type ExchangeRateFailureCode =
  | 'NO_EXACT_RATE'
  | 'RATE_UNAVAILABLE'
  | 'API_KEY_MISSING'
  | 'PROVIDER_UNAUTHORIZED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR';

export type ExchangeRateResult =
  | {
      ok: true;
      rate: number;
      source: 'api' | 'cache' | 'cache_last_published' | 'identity';
      /** Fecha de la tasa aplicada; puede ser anterior al día pedido. */
      rateDate?: string;
    }
  | {
      ok: false;
      code: ExchangeRateFailureCode;
      message: string;
      retryable: boolean;
      providerStatus?: number;
    };

export interface ExchangeRatePort {
  /**
   * Exact-date quote, for display. It never falls back to another day: a
   * missing publication returns `NO_EXACT_RATE`.
   */
  getHistoricalRate(params: {
    from: string;
    to: string;
    date: string; // YYYY-MM-DD
  }): Promise<ExchangeRateResult>;
  /**
   * Ledger conversion. It uses the exact date when published and, for weekends
   * and holidays, the last published rate on or before the date. The result
   * carries the date of the rate actually used.
   */
  getLedgerRate(params: {
    from: string;
    to: string;
    date: string; // YYYY-MM-DD
  }): Promise<ExchangeRateResult>;
  /** Latest cached rate on or before `date`; never calls the provider. */
  getLatestRateOnOrBefore(params: {
    from: string;
    to: string;
    date: string; // YYYY-MM-DD
  }): Promise<ExchangeRateResult>;
  listCurrencies(): Promise<string[]>;
}
