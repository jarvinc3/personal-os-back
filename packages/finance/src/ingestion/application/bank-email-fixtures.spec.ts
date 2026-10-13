import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  accountHintFromTerminatedIn,
  isCardPaymentReminder,
  looksLikePayrollWithoutAmount,
  sanitizeAccountNumberHint,
} from './email-movement';
import { stripHtmlToText } from '../infrastructure/gmail-api.util';

type FixtureCase = {
  name: string;
  contains: string[];
  payrollWithoutAmount?: boolean;
};

const fixturesDir = join(
  __dirname,
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'bank-emails',
);

const CASES: FixtureCase[] = [
  {
    name: 'popular/deposito-nomina-v1',
    contains: ['3447'],
    payrollWithoutAmount: true,
  },
  {
    name: 'popular/deposito-nomina-v1-corto',
    contains: ['3447'],
    payrollWithoutAmount: true,
  },
  {
    name: 'popular/deposito-nomina-v2',
    contains: ['3447'],
    payrollWithoutAmount: true,
  },
  {
    name: 'bhd/consumo-tarjeta',
    contains: ['75.50', '6506', 'SM NACIONAL LOPE DE VE'],
  },
  {
    name: 'bhd/pago-servicio',
    contains: ['1234.56', 'M04-4444-5555-6666-7', '8095550123'],
  },
  {
    name: 'bhd/pago-servicio-confirmacion',
    contains: ['1234.56', 'M04-4444-5555-6666-7', '8095550123'],
  },
  {
    name: 'bhd/transferencia-otros-bancos',
    contains: ['1,500.00', 'M02-2222-3333-4444-5'],
  },
  {
    name: 'bhd/transferencia-otros-bancos-confirmacion',
    contains: ['2,750.00', 'M03-3333-4444-5555-6'],
  },
  {
    name: 'bhd/transferencia-mis-productos',
    contains: ['12,345.67', 'M01-1111-2222-3333-4'],
  },
  {
    name: 'popular/retiro',
    contains: ['RD$500.00', '5089', 'BANCO POPULAR NACIONAL LO'],
  },
  {
    name: 'popular/pagos-al-instante-enviada',
    contains: ['325.00', 'LUIS MIGUEL SANTOS FERNANDE'],
  },
  {
    name: 'popular/pagos-al-instante-en-proceso',
    contains: ['325.00', 'LUIS MIGUEL SANTOS FERNANDE'],
  },
  {
    name: 'qik/deposito-recibido',
    contains: ['3,200.00', '3695', 'BANCO BHD LEON'],
  },
  {
    name: 'qik/toke-recibido',
    contains: ['2,500.00', '2581'],
  },
];

function readFixture(name: string) {
  const html = readFileSync(join(fixturesDir, `${name}.html`), 'utf8');
  const meta = JSON.parse(
    readFileSync(join(fixturesDir, `${name}.json`), 'utf8'),
  ) as { subject: string; from: string };
  return { text: stripHtmlToText(html), subject: meta.subject };
}

describe('bank email fixtures', () => {
  for (const testCase of CASES) {
    it(`${testCase.name} keeps the data the extractor needs`, () => {
      const { text } = readFixture(testCase.name);

      expect(text.length).toBeGreaterThan(0);
      for (const fragment of testCase.contains) {
        expect(text).toContain(fragment);
      }
    });
  }

  it('does not silently drop the Popular payroll notices', () => {
    for (const name of [
      'popular/deposito-nomina-v1',
      'popular/deposito-nomina-v1-corto',
      'popular/deposito-nomina-v2',
    ]) {
      const { text, subject } = readFixture(name);

      expect(looksLikePayrollWithoutAmount(subject, text)).toBe(true);
      expect(accountHintFromTerminatedIn(text)).toBe('3447');
      expect(sanitizeAccountNumberHint(text, '3447')).toBe('3447');
    }
  });

  it('reads the BHD service payment from its confirmation number', () => {
    const first = readFixture('bhd/pago-servicio').text;
    const second = readFixture('bhd/pago-servicio-confirmacion').text;
    const confirmation = 'M04-4444-5555-6666-7';

    expect(first).toContain(confirmation);
    expect(second).toContain(confirmation);
  });

  it('keeps the Popular instant transfer identical in both notices', () => {
    const enviada = readFixture('popular/pagos-al-instante-enviada').text;
    const enProceso = readFixture('popular/pagos-al-instante-en-proceso').text;

    expect(enviada).toContain('LUIS MIGUEL SANTOS FERNANDE');
    expect(enProceso).toContain('LUIS MIGUEL SANTOS FERNANDE');
    expect(enviada).toContain('325.00');
    expect(enProceso).toContain('325.00');
  });

  it('flags the BHD card payment reminder and no other notice', () => {
    const reminder = readFixture('bhd/recordatorio-pago-tarjeta');
    const purchase = readFixture('bhd/consumo-tarjeta');

    expect(
      isCardPaymentReminder({ subject: reminder.subject, body: reminder.text }),
    ).toBe(true);
    expect(
      isCardPaymentReminder({ subject: purchase.subject, body: purchase.text }),
    ).toBe(false);
  });
});
