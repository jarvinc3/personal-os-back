/** Calendar date (`YYYY-MM-DD`) as the subscription API sends it. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC of the calendar day the value falls on. */
export function dateOnly(value: Date): Date {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
