import { createHash } from 'crypto';

/**
 * Stable identity of a bank email: from, subject and body with repeated
 * whitespace collapsed and lowercased. Used to skip an already-processed
 * message before calling the extractor.
 */
export function emailFingerprint(input: {
  from: string;
  subject: string;
  body: string;
}): string {
  const normalized = [input.from, input.subject, input.body]
    .map((part) => part.replace(/\s+/g, ' ').trim().toLowerCase())
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}
