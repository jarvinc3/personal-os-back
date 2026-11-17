import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EmailProductHints } from '@personal-os/contracts';
import { parseBhdFixedFormat } from './bhd-email-format';

type PilotExpected = {
  fixedFormat: boolean;
  semanticType?: string;
  movementClass?: string;
  direction?: string;
  amount?: number;
  currency?: string;
  transactionDate?: string;
  last4?: string;
  accountNumberLast4?: string;
  merchant?: string;
};

type PilotEmail = {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  text: string;
  expected: PilotExpected;
};

type PilotFixture = {
  productHints: EmailProductHints;
  emails: PilotEmail[];
};

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../test/fixtures/bhd-emails/pilot-v6-20.json'),
    'utf8',
  ),
) as PilotFixture;

describe('piloto BHD v6: los 20 correos', () => {
  it.each(fixture.emails.map((email) => [email.messageId, email]))(
    'clasifica %s con el formato fijo',
    (_messageId, email) => {
      const parsed = parseBhdFixedFormat({
        fromDomain: 'bhd.com.do',
        subject: email.subject,
        body: email.text,
        receivedAt: new Date(email.date),
        productHints: fixture.productHints,
      });

      if (!email.expected.fixedFormat) {
        expect(parsed).toBeNull();
        return;
      }

      expect(parsed?.semanticType).toBe(email.expected.semanticType);
      if (email.expected.semanticType === 'FIN_STATEMENT_NOTICE') {
        expect(parsed?.transaction).toBeUndefined();
        return;
      }

      expect(parsed?.transaction).toMatchObject({
        movementClass: email.expected.movementClass,
        direction: email.expected.direction,
        amount: email.expected.amount,
        currency: email.expected.currency,
        transactionDate: email.expected.transactionDate,
        ...(email.expected.last4 ? { last4: email.expected.last4 } : {}),
        ...(email.expected.accountNumberLast4
          ? { accountNumberLast4: email.expected.accountNumberLast4 }
          : {}),
        ...(email.expected.merchant
          ? { merchant: email.expected.merchant }
          : {}),
      });
    },
  );
});
