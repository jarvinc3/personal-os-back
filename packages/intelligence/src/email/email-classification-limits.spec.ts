import {
  estimateClassificationTokens,
  globalCostStatus,
  isBankSenderDomain,
  maxClassificationCostUsd,
  PROMPT_OVERHEAD_CHARS,
  startOfUtcDay,
  utcDayKey,
  type EmailClassificationLimits,
} from './email-classification-limits';

const limits: EmailClassificationLimits = {
  classificationsPerMinute: 20,
  initialBudget: 500,
  dailyTokenBudget: 320_000,
  dailyCostLimitUsd: 5,
  costAlertRatio: 0.8,
  maxContentChars: 24_000,
  maxSubjectChars: 1_000,
  maxSenderChars: 320,
  bankSenderDomains: ['bhd.com.do', 'popular.com.do'],
};

describe('Email classification limits', () => {
  it('reserva al menos el costo de los cuatro intentos con la salida máxima', () => {
    // Todo lo que se envía está recortado: contenido, asunto, remitente y el
    // sobre del prompt. En el peor caso UTF-8 cada carácter son 4 bytes y un
    // token nunca supera un byte; la salida la limitan los proveedores a 4096.
    const promptChars =
      limits.maxContentChars +
      limits.maxSubjectChars +
      limits.maxSenderChars +
      PROMPT_OVERHEAD_CHARS;
    const worstCaseUsd =
      (4 * (promptChars * 4 * 0.2 + 4_096 * 0.6)) / 1_000_000;

    expect(maxClassificationCostUsd(limits)).toBeGreaterThanOrEqual(
      worstCaseUsd,
    );
  });

  it('la reserva de costo crece con los topes configurados', () => {
    expect(
      maxClassificationCostUsd({ ...limits, maxContentChars: 48_000 }),
    ).toBeGreaterThan(maxClassificationCostUsd(limits));
  });

  it('reserva tokens de entrada y la salida máxima por intento', () => {
    const reserved = estimateClassificationTokens({
      limits,
      contentChars: 0,
    });

    expect(reserved).toBeGreaterThan(4_096);
    expect(
      estimateClassificationTokens({ limits, contentChars: 24_000 }),
    ).toBeGreaterThan(reserved);
  });

  it('marca la alerta al 80 % y la pausa al 100 %', () => {
    const costLimits = {
      limitUsd: limits.dailyCostLimitUsd,
      alertRatio: limits.costAlertRatio,
    };
    expect(globalCostStatus({ costUsd: 3.99, ...costLimits })).toBe('OK');
    expect(globalCostStatus({ costUsd: 4, ...costLimits })).toBe('ALERT');
    expect(globalCostStatus({ costUsd: 4.99, ...costLimits })).toBe('ALERT');
    expect(globalCostStatus({ costUsd: 5, ...costLimits })).toBe('PAUSED');
    expect(globalCostStatus({ costUsd: 6, ...costLimits })).toBe('PAUSED');
    expect(globalCostStatus({ costUsd: 1, limitUsd: 1, alertRatio: 0.5 })).toBe(
      'PAUSED',
    );
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
    expect(isBankSenderDomain('bhd.com.do', limits.bankSenderDomains)).toBe(
      true,
    );
    expect(
      isBankSenderDomain('alertas.bhd.com.do', limits.bankSenderDomains),
    ).toBe(true);
    expect(isBankSenderDomain('notbhd.com.do', limits.bankSenderDomains)).toBe(
      false,
    );
    expect(isBankSenderDomain('example.com', limits.bankSenderDomains)).toBe(
      false,
    );
  });

  it('acepta una lista de bancos configurada por entorno', () => {
    expect(isBankSenderDomain('bhd.com.do', ['otro-banco.com'])).toBe(false);
    expect(isBankSenderDomain('otro-banco.com', ['otro-banco.com'])).toBe(true);
  });
});
