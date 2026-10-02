export function moduleDisabledMessage(slug: string): string {
  const label = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `${label} module is disabled`;
}
