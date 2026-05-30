export type ParsedTransaction = {
  amount: number;
  currency: string;
  merchant: string | null;
  description: string;
  transactionDate: string;
};

export interface EmailParser {
  readonly bankDomain: string;
  canParse(fromAddress: string): boolean;
  parse(subject: string, body: string): ParsedTransaction | null;
}
