export type ParsedTransaction = {
  amount: number;
  currency: string;
  merchant: string | null;
  description: string;
  transactionDate: string;
  type?: 'DEBIT' | 'CREDIT';
};

export interface EmailParser {
  readonly bankDomain: string;
  canParse(fromAddress: string): boolean;
  parse(subject: string, body: string): ParsedTransaction | null;
}
