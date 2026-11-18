import {
  isSenderFilter,
  matchesSenderFilter,
  normalizeSenderFilter,
  resolveImportStartAt,
} from './gmail-import-scope';

describe('Gmail import scope', () => {
  it('empieza hoy a la medianoche UTC', () => {
    expect(
      resolveImportStartAt({
        period: 'TODAY',
        now: new Date('2026-11-18T15:20:00.000Z'),
      }),
    ).toEqual(new Date('2026-11-18T00:00:00.000Z'));
  });

  it('retrocede un mes de calendario', () => {
    expect(
      resolveImportStartAt({
        period: 'LAST_MONTH',
        now: new Date('2026-11-18T15:20:00.000Z'),
      }),
    ).toEqual(new Date('2026-10-18T00:00:00.000Z'));
  });

  it('retrocede tres meses de calendario', () => {
    expect(
      resolveImportStartAt({
        period: 'LAST_3_MONTHS',
        now: new Date('2026-11-18T15:20:00.000Z'),
      }),
    ).toEqual(new Date('2026-08-18T00:00:00.000Z'));
  });

  it('ajusta el día al último del mes cuando no existe', () => {
    expect(
      resolveImportStartAt({
        period: 'LAST_MONTH',
        now: new Date('2026-03-31T10:00:00.000Z'),
      }),
    ).toEqual(new Date('2026-02-28T00:00:00.000Z'));
    expect(
      resolveImportStartAt({
        period: 'LAST_MONTH',
        now: new Date('2026-05-31T10:00:00.000Z'),
      }),
    ).toEqual(new Date('2026-04-30T00:00:00.000Z'));
  });

  it('cruza el cambio de año', () => {
    expect(
      resolveImportStartAt({
        period: 'LAST_3_MONTHS',
        now: new Date('2026-01-15T10:00:00.000Z'),
      }),
    ).toEqual(new Date('2025-10-15T00:00:00.000Z'));
  });

  it('normaliza y valida el filtro de remitente', () => {
    expect(normalizeSenderFilter('  BHD.com.do ')).toBe('bhd.com.do');
    expect(normalizeSenderFilter(null)).toBeNull();
    expect(normalizeSenderFilter('   ')).toBeNull();
    expect(isSenderFilter('bhd.com.do')).toBe(true);
    expect(isSenderFilter('alerts.bhd.com.do')).toBe(true);
    expect(isSenderFilter('bhd')).toBe(false);
    expect(isSenderFilter('bhd..com')).toBe(false);
    expect(isSenderFilter('from:bhd.com.do')).toBe(false);
  });

  it('acepta el dominio y sus subdominios, no dominios parecidos', () => {
    expect(
      matchesSenderFilter({
        fromDomain: 'bhd.com.do',
        senderFilter: 'bhd.com.do',
      }),
    ).toBe(true);
    expect(
      matchesSenderFilter({
        fromDomain: 'alerts.bhd.com.do',
        senderFilter: 'bhd.com.do',
      }),
    ).toBe(true);
    expect(
      matchesSenderFilter({
        fromDomain: 'notbhd.com.do',
        senderFilter: 'bhd.com.do',
      }),
    ).toBe(false);
  });
});
