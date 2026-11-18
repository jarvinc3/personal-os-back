import {
  globalCostStatus,
  isBankSenderDomain,
  recentClassificationTimestamps,
  startOfUtcDay,
} from './email-classification-limits';

describe('Email classification limits', () => {
  it('marca la alerta al 80 % y la pausa al 100 %', () => {
    expect(globalCostStatus({ costUsd: 3.99 })).toBe('OK');
    expect(globalCostStatus({ costUsd: 4 })).toBe('ALERT');
    expect(globalCostStatus({ costUsd: 4.99 })).toBe('ALERT');
    expect(globalCostStatus({ costUsd: 5 })).toBe('PAUSED');
    expect(globalCostStatus({ costUsd: 6 })).toBe('PAUSED');
  });

  it('empieza el día en UTC', () => {
    expect(startOfUtcDay(new Date('2026-11-18T23:59:59.000Z'))).toEqual(
      new Date('2026-11-18T00:00:00.000Z'),
    );
    expect(startOfUtcDay(new Date('2026-11-19T00:00:00.000Z'))).toEqual(
      new Date('2026-11-19T00:00:00.000Z'),
    );
  });

  it('reconoce bancos y sus subdominios, no dominios parecidos', () => {
    expect(isBankSenderDomain('bhd.com.do')).toBe(true);
    expect(isBankSenderDomain('alertas.bhd.com.do')).toBe(true);
    expect(isBankSenderDomain('notbhd.com.do')).toBe(false);
    expect(isBankSenderDomain('example.com')).toBe(false);
  });

  it('conserva solo los timestamps del último minuto', () => {
    const now = new Date('2026-11-18T12:00:00.000Z');
    const recent = now.getTime() - 30_000;
    const old = now.getTime() - 61_000;
    expect(
      recentClassificationTimestamps({
        timestamps: [old, recent, now.getTime()],
        now,
      }),
    ).toEqual([recent, now.getTime()]);
  });
});
