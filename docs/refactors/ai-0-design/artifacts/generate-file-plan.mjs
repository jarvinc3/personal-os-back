// Read-only inventory of source trees; writes only this design artifact.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const back = resolve(here, '../../../..');
const web = resolve(back, '../personal-os-web');
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const inventories = [];
for (const [name, root] of [
  ['back', back],
  ['web', web],
]) {
  const files = git(
    root,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
  ).split('\n');
  const entries = [];
  for (const path of [...new Set(files)]) {
    if (!/\.(ts|tsx)$/.test(path) || path.startsWith('docs/')) continue;
    let content;
    let deleted = false;
    try {
      content = readFileSync(resolve(root, path));
    } catch {
      deleted = true;
      content = execFileSync('git', ['show', `HEAD:${path}`], { cwd: root });
    }
    const text = content.toString('utf8');
    const relevant =
      name === 'back'
        ? /FinEmail|emailMessageId|aiAgentSession|aiMessage|AI_CHAT_COMPLETION|ChatContext|EMAIL_SYNC|emailConnections|emailMessages/.test(
            text,
          ) || /ingestion\/|ai-agent\/|wipe|email-sync-schedule/.test(path)
        : /ChatContext|ChatLauncher|prefetchFinanceSync|email-sync|emailConnections|emailMessages|wipe-layers|useChat/.test(
            text,
          ) ||
          /modules\/ai\/|finance\/sync\/|wipe-layers|finance-prefetch|email-sync/.test(
            path,
          );
    if (!relevant) continue;
    let operation = 'ADAPT_CONSUMER_AND_TEST';
    if (
      name === 'back' &&
      /ai\.service|providers\/|stream-openai-chat-complete|is-retryable-provider-error|map-messages-to-open/.test(
        path,
      )
    )
      operation = 'PRESERVE_INFERENCE_AND_TESTS';
    else if (
      name === 'back' &&
      /import-email-transaction|resolve-email-ledger-target|match-email-transfers|email-dedupe|email-fingerprint|parse-extracted-email|email-movement|backfill-pending-email|route-extracted-email|prisma-ledger-email-import/.test(
        path,
      )
    )
      operation = 'PRESERVE_FINANCIAL_RULES_ADAPT_PORTS_AND_TESTS';
    else if (/notifications\/.*email-sync/.test(path))
      operation = 'KEEP_RESEND_PROCESSOR_AND_TESTS';
    else if (
      name === 'back' &&
      /ingestion\/.*(gmail|processor|scheduler|email-source|email-sync.controller)/.test(
        path,
      )
    )
      operation = 'REMOVE_GMAIL_TRANSPORT_AND_EXCLUSIVE_TESTS';
    else if (/ai-actions/.test(path))
      operation = 'DETACH_SESSION_OWNERSHIP_PRESERVE_CAS_DISABLE_RUNTIME';
    else if (
      name === 'back' &&
      /ai-agent\/.*(chat\/|tools\/|prompts\/)/.test(path)
    )
      operation = 'REMOVE_OLD_CHAT_REVIEW_SHARED_HELPERS';
    else if (name === 'web' && /modules\/ai\/|app\/\(app\)\/chat\//.test(path))
      operation = 'REMOVE_OLD_CHAT_REVIEW_REUSABLE_ENTITY_CARDS';
    else if (name === 'web' && /finance\/sync\/|email-sync/.test(path))
      operation = 'REMOVE_GMAIL_SURFACE_AND_TESTS';
    entries.push({
      path,
      operation,
      deletedInWorktree: deleted,
      sha256: hash(content),
    });
  }
  inventories.push({
    repo: name,
    revision: git(root, 'rev-parse', 'HEAD'),
    worktreeStatus: git(root, 'status', '--porcelain'),
    entries,
  });
}
const proposedFiles = [
  'packages/contracts/package.json',
  'packages/contracts/tsconfig.json',
  'packages/contracts/src/index.ts',
  'packages/contracts/src/inference.ts',
  'packages/contracts/src/capabilities.ts',
  'packages/contracts/src/settings.ts',
  'packages/contracts/src/notifications.ts',
  'packages/contracts/src/events.ts',
  'packages/contracts/src/signals.ts',
  'apps/api/src/module-settings/descriptors/agenda.settings.descriptor.ts',
  'apps/api/src/module-settings/descriptors/projects.settings.descriptor.ts',
  'apps/api/src/module-settings/descriptors/health.settings.descriptor.ts',
  'packages/finance/src/shared/settings.descriptor.ts',
  'packages/ai-agent/src/shared/settings.descriptor.ts',
  'packages/finance/src/ingestion/application/ports/pending-financial-candidates.port.ts',
];
writeFileSync(
  resolve(here, 'file-plan.json'),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      status: 'PROPOSED_NOT_EXECUTED',
      rule: 'Review each consumer; never bulk-delete by substring. Preserve dirty web work.',
      inventories,
      proposedFiles,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  inventories
    .map(
      ({ repo, entries }) => `${repo}: ${entries.length} reviewed candidates`,
    )
    .join('\n'),
);
