export type QuickEntryCatalogAccount = {
  id: string;
  name: string;
  institutionName: string | null;
  accountNumber: string | null;
  currency: string;
};

export type QuickEntryCatalogCard = {
  id: string;
  name: string;
  network: string | null;
  lastFour: string | null;
  currency: string | null;
};

export type QuickEntryCatalogCategory = {
  id: string;
  name: string;
  type: string;
};

export type QuickEntryExtractionInput = {
  text: string;
  todayIso: string;
  baseCurrency: string;
  categories: QuickEntryCatalogCategory[];
  accounts: QuickEntryCatalogAccount[];
  cards: QuickEntryCatalogCard[];
};

export type QuickEntryExtraction = {
  type: 'DEBIT' | 'CREDIT';
  amount: string;
  currency: string;
  categoryNameHint: string | null;
  accountHint: string | null;
  cardHint: string | null;
  /** Real YYYY-MM-DD calendar date, or null when the sentence states none. */
  date: string | null;
  merchant: string | null;
  description: string | null;
  confidence: number;
};

export interface QuickEntryExtractorPort {
  extract(input: QuickEntryExtractionInput): Promise<QuickEntryExtraction>;
}
