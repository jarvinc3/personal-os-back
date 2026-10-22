import { isIanaTimeZone } from './timezone';

describe('isIanaTimeZone', () => {
  it('accepts the zones the app uses', () => {
    expect(isIanaTimeZone('America/Santo_Domingo')).toBe(true);
    expect(isIanaTimeZone('America/La_Paz')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
  });

  it('accepts current names the runtime still resolves', () => {
    expect(isIanaTimeZone('Europe/Kyiv')).toBe(true);
    expect(isIanaTimeZone('Asia/Kolkata')).toBe(true);
  });

  it('trims the value before checking it', () => {
    expect(isIanaTimeZone(' America/La_Paz ')).toBe(true);
  });

  it('rejects empty, unknown and malformed zones', () => {
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone('   ')).toBe(false);
    expect(isIanaTimeZone('Mars/Olympus')).toBe(false);
    expect(isIanaTimeZone('America/Santo Domingo')).toBe(false);
    expect(isIanaTimeZone('+04:00')).toBe(false);
  });
});
