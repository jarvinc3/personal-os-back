// Generates a review artifact only. Never changes the runtime schema or DB.
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const source = execFileSync(
  'git',
  [
    'show',
    '018c4e021a1f54e755500ee3afefa9dc3037c84f:packages/database/prisma/schema.prisma',
  ],
  { cwd: repo, encoding: 'utf8' },
);
const removedModels = [
  'AiAgentSession',
  'AiMessage',
  'FinEmailConnection',
  'FinEmailSource',
  'FinEmailMessage',
  'FinEmailSyncLog',
];
const removedEnums = ['AiRole', 'FinEmailMessageOutcome', 'FinEmailSyncStatus'];
let candidate = source.replaceAll('\r\n', '\n');
for (const [kind, names] of [
  ['model', removedModels],
  ['enum', removedEnums],
]) {
  for (const name of names) {
    const pattern = new RegExp(`^${kind} ${name} \\{[\\s\\S]*?^\\}\\n*`, 'm');
    if (!pattern.test(candidate)) {
      throw new Error(`Missing expected ${kind} ${name}`);
    }
    candidate = candidate.replace(pattern, '');
  }
}
const removedTypes = new RegExp(`\\b(${removedModels.join('|')})\\b`);
candidate = candidate
  .split('\n')
  .filter((line) => !removedTypes.test(line))
  .join('\n');
candidate = candidate.replace(/^model AiAction \{[\s\S]*?^\}/m, (block) => {
  const lines = block
    .split('\n')
    .filter(
      (line) =>
        !/^\s+(sessionId|messageId)\s/.test(line) &&
        !/^\s+@@index\(\[(sessionId|messageId)\]/.test(line),
    );
  lines.splice(
    2,
    0,
    '  originType      String  @default("AGENT") @map("origin_type")',
    '  originReference String? @map("origin_reference")',
  );
  return lines.join('\n');
});
const emailField =
  /^\s+emailMessageId\s+String\?\s+@unique @map\("email_message_id"\)$/m;
if (!emailField.test(candidate)) {
  throw new Error('Missing FinTransaction email FK scalar');
}
candidate = candidate.replace(
  emailField,
  '  /// Opaque financial import identity; no foreign key to an AI/source table.\n' +
    '  importReference String? @map("import_reference")',
);
candidate = candidate.replace(/^model FinTransaction \{[\s\S]*?^\}/m, (block) =>
  block.replace(
    '  @@map("fin_transactions")',
    '  @@unique([userId, importReference], map: "fin_transactions_user_import_reference_key")\n' +
      '  @@map("fin_transactions")',
  ),
);
if (/\b(FinEmail\w*|AiAgentSession|AiMessage|AiRole)\b/.test(candidate)) {
  throw new Error('Removed model/enum still referenced');
}
candidate = candidate.replaceAll(
  'uuid_generate_v4()',
  'extensions.uuid_generate_v4()',
);
candidate = candidate.replace(/^model FinTransaction \{[\s\S]*?^\}/m, (block) =>
  block.replace(
    /^\s*@@index\(\[transferGroupId\](?:,\s*map:\s*"fin_transactions_transfer_group_id_idx")?\)\r?\n/m,
    '',
  ),
);
await writeFile(resolve(here, 'schema.prisma'), candidate);
console.log(
  `Candidate schema: ${[...candidate.matchAll(/^model /gm)].length} models; no runtime files changed.`,
);
