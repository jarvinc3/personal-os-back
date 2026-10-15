const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in YYYY-MM-DD form ("2026-02-31" is false). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
