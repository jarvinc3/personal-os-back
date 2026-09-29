const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** Host only, lowercase, without scheme, www, port, path, or query. */
export function normalizeDomain(input: string): string | null {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
  domain = domain.split('/')[0]?.split('?')[0]?.split('#')[0] ?? '';
  domain = domain.split(':')[0] ?? '';
  return DOMAIN_RE.test(domain) ? domain : null;
}
