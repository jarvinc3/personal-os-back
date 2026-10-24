// Capture non-Prisma invariants from a migrated LOCAL reference fixture only.
// No .env fallback, no DDL/DML against the source. Writes design artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.AI0_REFERENCE_DATABASE_URL;
if (
  !url ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('Explicit LOCAL AI0_REFERENCE_DATABASE_URL required');
}
const schema = await readFile(resolve(here, 'schema.prisma'), 'utf8');
const tables = [...schema.matchAll(/^model \w+ \{[\s\S]*?^\}/gm)].map(
  (match) => match[0].match(/@@map\("([^"\n]+)"\)/)[1],
);
const pool = new pg.Pool({
  connectionString: url,
  application_name: 'ai0-design-reference',
});
const client = await pool.connect();
const qid = (value) => '"' + value.replaceAll('"', '""') + '"';
const qstr = (value) => "'" + value.replaceAll("'", "''") + "'";
try {
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '5s'");
  const checks = (
    await client.query(
      `
    SELECT c.relname AS table_name, co.conname AS name, pg_get_constraintdef(co.oid) AS definition
    FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND co.contype='c' AND c.relname=ANY($1::text[])
    ORDER BY c.relname, co.conname`,
      [tables],
    )
  ).rows;
  const indexes = (
    await client.query(
      `
    SELECT tablename AS table_name, indexname AS name, indexdef AS definition
    FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) AND indexdef LIKE '% WHERE %'
    ORDER BY tablename,indexname`,
      [tables],
    )
  ).rows;
  const policies = (
    await client.query(
      `
    SELECT tablename AS table_name, policyname AS name, permissive, roles::text[] AS roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname`,
      [tables],
    )
  ).rows;
  const targetPolicies = policies.map((row) =>
    row.table_name === 'ai_actions'
      ? {
          ...row,
          qual: '(user_id = (SELECT auth.uid())::text)',
          with_check: '(user_id = (SELECT auth.uid())::text)',
        }
      : row,
  );
  const ddl =
    [
      '-- Non-Prisma CHECKs and partial indexes captured from the local migrated reference.',
      ...checks.map(
        (row) =>
          `ALTER TABLE public.${qid(row.table_name)} ADD CONSTRAINT ${qid(row.name)} ${row.definition};`,
      ),
      ...indexes.map((row) => row.definition + ';'),
    ].join('\n\n') + '\n';
  if (/email_message_id|fin_email_|ai_messages|ai_agent_sessions/.test(ddl)) {
    throw new Error('Non-Prisma invariant still depends on a removed object');
  }
  await writeFile(resolve(here, '02-invariants.sql'), ddl);
  const policySql =
    [
      '-- RLS is enabled even though public app tables are closed to the Data API.',
      ...tables.map(
        (table) =>
          `ALTER TABLE public.${qid(table)} ENABLE ROW LEVEL SECURITY;`,
      ),
      ...targetPolicies.map(
        (row) =>
          `CREATE POLICY ${qid(row.name)} ON public.${qid(row.table_name)} AS ${row.permissive} FOR ${row.cmd} TO ${row.roles.map(qid).join(', ')}${row.qual ? ' USING (' + row.qual + ')' : ''}${row.with_check ? ' WITH CHECK (' + row.with_check + ')' : ''};`,
      ),
    ].join('\n\n') + '\n';
  if (/fin_email_|ai_messages|ai_agent_sessions/.test(policySql)) {
    throw new Error('Policy still depends on a removed object');
  }
  await writeFile(resolve(here, '03-rls.sql'), policySql);
  const seed = [
    `-- Explicit DEV bootstrap: these rows are absent in the migrated empty reference.\n` +
      `INSERT INTO public.modules (id,slug,key,name,sort_order) VALUES\n` +
      `('00000000-0000-4000-8000-000000000001','finance','FINANCE','Finanzas',1),\n` +
      `('00000000-0000-4000-8000-000000000002','agenda','AGENDA','Agenda',2),\n` +
      `('00000000-0000-4000-8000-000000000003','projects','PROJECTS','Proyectos',3),\n` +
      `('00000000-0000-4000-8000-000000000004','health','HEALTH','Salud',4)\n` +
      `ON CONFLICT (slug) DO NOTHING;`,
  ];
  const seedCounts = {};
  for (const table of ['modules', 'fin_categories', 'fin_institutions']) {
    const where =
      table === 'modules' ? '' : ' WHERE is_system=true AND user_id IS NULL';
    const rows = (
      await client.query(
        `SELECT row_to_json(t) AS value FROM public.${qid(table)} t${where} ORDER BY id`,
      )
    ).rows.map((row) => row.value);
    seedCounts[table] = rows.length;
    if (table === 'modules') {
      continue;
    }
    seed.push(
      `-- ${table}: ${rows.length} reference rows, no per-user data.\nINSERT INTO public.${qid(table)} SELECT * FROM jsonb_populate_recordset(NULL::public.${qid(table)}, ${qstr(JSON.stringify(rows))}::jsonb) ON CONFLICT (id) DO NOTHING;`,
    );
  }
  await writeFile(
    resolve(here, '05-reference-data.sql'),
    seed.join('\n\n') + '\n',
  );
  const manifest = {
    source: 'local-postgres-reference-only',
    sourceRevision: '37b9ec875a640e023745add670a7d3b381a83c12',
    tables: tables.sort(),
    checks,
    partialIndexes: indexes,
    sourcePolicies: policies,
    targetPolicies,
    referenceRows: seedCounts,
    policyChanges: [
      'ai_actions ownership uses its user_id instead of the removed conversation session',
    ],
    bootstrapChanges: [
      'Create the four configurable module rows; a migrated empty database currently has none',
    ],
    sourceSchemaSha256: createHash('sha256').update(schema).digest('hex'),
  };
  await writeFile(
    resolve(here, 'invariants-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      tables: tables.length,
      checks: checks.length,
      partialIndexes: indexes.length,
      policies: policies.length,
      referenceRows: seedCounts,
    }),
  );
  await client.query('ROLLBACK');
} finally {
  client.release();
  await pool.end();
}
