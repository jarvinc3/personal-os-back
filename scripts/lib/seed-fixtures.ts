import { createHash } from 'node:crypto';

type SeedUuidInput = {
  seedVersion: string;
  scope: string;
  type: string;
  key: string;
  userId: string | null;
};

export function seedUuid({
  seedVersion,
  scope,
  type,
  key,
  userId,
}: SeedUuidInput): string {
  const hex = createHash('sha256')
    .update(`${seedVersion}|${scope}|${userId ?? ''}|${type}|${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
