/**
 * Institutions order by `(sortOrder, name, id)`, so the cursor key carries the
 * first two fields packed with a NUL sentinel that a name cannot contain.
 */
const SEPARATOR = '\u0000';

export function institutionOrderKey(row: {
  sortOrder: number;
  name: string;
}): string {
  return `${row.sortOrder}${SEPARATOR}${row.name}`;
}

export function parseInstitutionOrderKey(
  key: string,
): { sortOrder: number; name: string } | null {
  const index = key.indexOf(SEPARATOR);
  if (index < 0) {
    return null;
  }
  const sortOrder = Number(key.slice(0, index));
  const name = key.slice(index + 1);
  if (!Number.isInteger(sortOrder) || name.length === 0) {
    return null;
  }
  return { sortOrder, name };
}
