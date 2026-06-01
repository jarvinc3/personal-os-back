import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEmailFixture(filename: string): {
  from: string;
  subject: string;
  body: string;
} {
  const raw = readFileSync(join(__dirname, '__fixtures__', filename), 'utf8');
  const from = raw.match(/^From:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const subject = raw.match(/^Subject:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const htmlStart = raw.search(/<html|<table border/i);
  const plainStart = raw.search(/^------=_Part/m);
  let body = raw;
  if (htmlStart >= 0) {
    body = raw.slice(htmlStart);
  } else if (plainStart >= 0) {
    const afterHeaders = raw.indexOf('\n\n', plainStart);
    body = afterHeaders >= 0 ? raw.slice(afterHeaders) : raw;
  }
  return { from, subject, body };
}
