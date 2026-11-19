import {
  globalCostStatus,
  isBankSenderDomain,
  startOfUtcDay,
  utcDayKey,
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

  it('nombra el día UTC con la clave que compara el SQL', () => {
    expect(utcDayKey(new Date('2026-11-18T23:59:59.000Z'))).toBe('2026-11-18');
    expect(utcDayKey(new Date('2026-11-19T00:00:00.000Z'))).toBe('2026-11-19');
  });

  it('reconoce bancos y sus subdominios, no dominios parecidos', () => {
    expect(isBankSenderDomain('bhd.com.do')).toBe(true);
    expect(isBankSenderDomain('alertas.bhd.com.do')).toBe(true);
    expect(isBankSenderDomain('notbhd.com.do')).toBe(false);
    expect(isBankSenderDomain('example.com')).toBe(false);
  });
});
