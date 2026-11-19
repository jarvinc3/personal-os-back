import {
  globalCostStatus,
  isBankSenderDomain,
  MAX_CLASSIFICATION_COST_USD,
  MAX_EMAIL_CONTENT_CHARS,
  MAX_EMAIL_SENDER_CHARS,
  MAX_EMAIL_SUBJECT_CHARS,
  PROMPT_OVERHEAD_CHARS,
  startOfUtcDay,
  utcDayKey,
} from './email-classification-limits';

describe('Email classification limits', () => {
  it('reserva al menos el costo de los cuatro intentos con la salida máxima', () => {
    // Todo lo que se envía está recortado: contenido, asunto, remitente y el
    // sobre del prompt. En el peor caso UTF-8 cada carácter son 4 bytes y un
    // token nunca supera un byte; la salida la limitan los proveedores a 4096.
    const promptChars =
      MAX_EMAIL_CONTENT_CHARS +
      MAX_EMAIL_SUBJECT_CHARS +
      MAX_EMAIL_SENDER_CHARS +
      PROMPT_OVERHEAD_CHARS;
    const worstCaseUsd =
      (4 * (promptChars * 4 * 0.2 + 4_096 * 0.6)) / 1_000_000;

    expect(MAX_CLASSIFICATION_COST_USD).toBeGreaterThanOrEqual(worstCaseUsd);
  });

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
