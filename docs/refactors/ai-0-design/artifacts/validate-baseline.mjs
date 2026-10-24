// Local design validation only: creates a NEW disposable DB, never resets one.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const adminUrl = process.env.AI0_VALIDATION_ADMIN_URL;
if (
  !adminUrl ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(adminUrl).hostname)
) {
  throw new Error(
    'Explicit LOCAL AI0_VALIDATION_ADMIN_URL required; no .env fallback',
  );
}
const dbName = 'ai0_design_' + randomUUID().replaceAll('-', '');
const admin = new pg.Pool({
  connectionString: adminUrl,
  application_name: 'ai0-design-validation',
});
await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.end();
const targetUrl = new URL(adminUrl);
targetUrl.pathname = '/' + dbName;
const pool = new pg.Pool({
  connectionString: targetUrl.toString(),
  application_name: 'ai0-design-validation',
});
const expected = JSON.parse(
  await readFile(resolve(here, 'invariants-manifest.json'), 'utf8'),
);
const tests = [];
const test = async (name, fn) => {
  await fn();
  tests.push({ name, passed: true });
};
const scalar = async (sql, params = []) =>
  (await pool.query(sql, params)).rows[0].value;
const expectSqlState = async (state, fn) => {
  await assert.rejects(fn, (error) => error.code === state);
};
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const oldAuth = '10000000-0000-4000-8000-000000000003';
const insertMovement = (
  userId,
  accountId,
  ref,
  bankRef = null,
  status = 'CONFIRMED',
) =>
  pool.query(
    `
  INSERT INTO public.fin_transactions(user_id,account_id,type,amount,ledger_amount,amount_base_currency,transaction_date,import_reference,external_reference,institution_id,status)
  VALUES($1,$2,'DEBIT',1,1,1,now(),$3,$4,'test-institution',$5::"FinTransactionStatus")`,
    [userId, accountId, ref, bankRef, status],
  );

try {
  assert.equal(
    await scalar(
      "SELECT count(*)::int AS value FROM pg_tables WHERE schemaname='public'",
    ),
    0,
  );
  // Explicit fixtures for managed services, NOT an emulation of Supabase Auth/Storage APIs.
  await pool.query(`CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    INSERT INTO storage.buckets VALUES('logos',true,NULL,ARRAY['image/svg+xml']);`);
  await pool.query('INSERT INTO auth.users VALUES($1,$2,$3)', [
    oldAuth,
    'preexisting@example.invalid',
    { full_name: 'Existing fixture' },
  ]);
  await test('Apply complete baseline to an empty app schema', async () => {
    for (const file of [
      '00-prerequisites.sql',
      '01-schema.sql',
      '02-invariants.sql',
      '03-rls.sql',
      '04-supabase.sql',
      '05-reference-data.sql',
      '06-dev-auth-reconcile.sql',
    ]) {
      await pool.query(await readFile(resolve(here, file), 'utf8'));
    }
  });
  await test('All 44 target tables exist; removed models are absent', async () => {
    const tables = (
      await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    assert.deepEqual(tables, expected.tables);
    assert.equal(
      tables.some(
        (name) =>
          name.startsWith('fin_email_') ||
          ['ai_messages', 'ai_agent_sessions'].includes(name),
      ),
      false,
    );
  });
  await test('Preserve non-Prisma checks and partial indexes exactly', async () => {
    const checks = (
      await pool.query(`SELECT c.relname AS table_name,co.conname AS name,pg_get_constraintdef(co.oid) AS definition
      FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND co.contype='c' ORDER BY c.relname,co.conname`)
    ).rows;
    assert.deepEqual(checks, expected.checks);
    const indexes = (
      await pool.query(
        "SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE '% WHERE %' ORDER BY tablename,indexname",
      )
    ).rows;
    assert.deepEqual(indexes, expected.partialIndexes);
  });
  await test('Enable RLS on every application table and retain policies', async () => {
    assert.equal(
      await scalar(
        "SELECT count(*)::int AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity",
      ),
      expected.tables.length,
    );
    assert.equal(
      await scalar(
        "SELECT count(*)::int AS value FROM pg_policies WHERE schemaname='public'",
      ),
      expected.targetPolicies.length,
    );
  });
  await test('Close table Data API privileges for anon and authenticated', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal(
        await scalar(
          `SELECT count(*)::int AS value FROM pg_tables WHERE schemaname='public' AND has_table_privilege($1,quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT,INSERT,UPDATE,DELETE')`,
          [role],
        ),
        0,
      );
    }
  });
  await test('Keep privileged auth trigger private and non-executable by clients', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal(
        await scalar(
          "SELECT has_function_privilege($1,'app_private.handle_new_user()','EXECUTE') AS value",
          [role],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        "SELECT count(*)::int AS value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef",
      ),
      0,
    );
  });
  await test('Restore DEV app profiles for preexisting Auth identities idempotently', async () => {
    assert.equal(
      await scalar('SELECT count(*)::int AS value FROM users WHERE id=$1', [
        oldAuth,
      ]),
      1,
    );
    await pool.query(
      await readFile(resolve(here, '06-dev-auth-reconcile.sql'), 'utf8'),
    );
    assert.equal(
      await scalar('SELECT count(*)::int AS value FROM users WHERE id=$1', [
        oldAuth,
      ]),
      1,
    );
  });
  await test('Bootstrap future Auth identities using the private trigger', async () => {
    await pool.query('INSERT INTO auth.users VALUES($1,$2,$3),($4,$5,$6)', [
      owner,
      'owner@example.invalid',
      { full_name: 'Owner fixture' },
      other,
      'other@example.invalid',
      {},
    ]);
    assert.equal(
      await scalar('SELECT full_name AS value FROM users WHERE id=$1', [owner]),
      'Owner fixture',
    );
    assert.equal(
      await scalar('SELECT full_name AS value FROM users WHERE id=$1', [other]),
      'other',
    );
  });
  await test('Seed four configurable modules and retain 31 system categories', async () => {
    assert.equal(await scalar('SELECT count(*)::int AS value FROM modules'), 4);
    assert.equal(
      await scalar(
        'SELECT count(*)::int AS value FROM fin_categories WHERE is_system AND user_id IS NULL',
      ),
      31,
    );
  });
  await pool.query(
    "INSERT INTO fin_institutions(id,user_id,name,type) VALUES('test-institution',$1,'Fixture bank','bank')",
    [owner],
  );
  await pool.query(
    "INSERT INTO fin_accounts(id,user_id,institution_id,name,type) VALUES('account-owner',$1,'test-institution','Owner account','CHECKING'),('account-other',$2,'test-institution','Other account','CHECKING')",
    [owner, other],
  );
  await test('Import references are unique within the user and opaque to sources', async () => {
    await insertMovement(owner, 'account-owner', 'opaque-import-1');
    await expectSqlState('23505', () =>
      insertMovement(owner, 'account-owner', 'opaque-import-1'),
    );
    await insertMovement(other, 'account-other', 'opaque-import-1');
    assert.equal(
      await scalar(
        "SELECT count(*)::int AS value FROM fin_transactions WHERE import_reference='opaque-import-1'",
      ),
      2,
    );
  });
  await test('Keep target XOR and currency checks', async () => {
    await expectSqlState('23514', () =>
      insertMovement(owner, null, 'invalid-target'),
    );
    await expectSqlState('23514', () =>
      pool.query(
        "UPDATE fin_accounts SET currency='XX' WHERE id='account-owner'",
      ),
    );
  });
  await test('Preserve bank-reference dedup and reversed exception', async () => {
    await insertMovement(owner, 'account-owner', 'bank-1', 'ref-1');
    await expectSqlState('23505', () =>
      insertMovement(owner, 'account-owner', 'bank-2', 'ref-1'),
    );
    await pool.query(
      "UPDATE fin_transactions SET status='REVERSED' WHERE user_id=$1 AND import_reference='bank-1'",
      [owner],
    );
    await insertMovement(owner, 'account-owner', 'bank-2', 'ref-1');
  });
  await test('RLS isolates users even if SELECT is temporarily granted for the probe', async () => {
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query('GRANT SELECT ON public.fin_accounts TO authenticated');
      await tx.query('SET LOCAL ROLE authenticated');
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        owner,
      ]);
      assert.deepEqual(
        (await tx.query('SELECT id FROM public.fin_accounts ORDER BY id')).rows,
        [{ id: 'account-owner' }],
      );
    } finally {
      await tx.query('ROLLBACK');
      tx.release();
    }
  });
  await test('AiAction has no conversation FK and retains atomic owner/status claims', async () => {
    const action = (
      await pool.query(
        "INSERT INTO ai_actions(user_id,action_type,target_module,payload) VALUES($1,'fixture','finance','{}') RETURNING id",
        [owner],
      )
    ).rows[0].id;
    const claim = (user) =>
      pool.query(
        "UPDATE ai_actions SET status='RUNNING',executed_at=now() WHERE id=$1 AND user_id=$2 AND status='PENDING' RETURNING id",
        [action, user],
      );
    assert.equal((await claim(other)).rowCount, 0);
    assert.equal(
      (await Promise.all([claim(owner), claim(owner)])).reduce(
        (sum, row) => sum + row.rowCount,
        0,
      ),
      1,
    );
    assert.equal(
      await scalar(
        "SELECT count(*)::int AS value FROM pg_constraint WHERE conrelid='public.ai_actions'::regclass AND contype='f' AND confrelid='public.users'::regclass",
      ),
      1,
    );
  });
  await test('Retain updated_at, outbox lease and consumer receipt uniqueness', async () => {
    await pool.query("UPDATE users SET updated_at='2000-01-01' WHERE id=$1", [
      owner,
    ]);
    assert.equal(
      await scalar(
        "SELECT updated_at>'2000-01-01'::timestamptz AS value FROM users WHERE id=$1",
        [owner],
      ),
      true,
    );
    await pool.query(
      "INSERT INTO processed_domain_events(event_id,consumer) VALUES('event','consumer')",
    );
    await expectSqlState('23505', () =>
      pool.query(
        "INSERT INTO processed_domain_events(event_id,consumer) VALUES('event','consumer')",
      ),
    );
    assert.equal(
      await scalar(
        "SELECT count(*)::int AS value FROM information_schema.columns WHERE table_schema='public' AND table_name='domain_event_outbox' AND column_name='claimed_at'",
      ),
      1,
    );
  });
  await test('Align logo bucket limits with runtime MIME validation', async () => {
    const bucket = (
      await pool.query("SELECT * FROM storage.buckets WHERE id='logos'")
    ).rows[0];
    assert.equal(Number(bucket.file_size_limit), 1048576);
    assert.deepEqual(bucket.allowed_mime_types, [
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);
  });
  const report = {
    verifiedAt: new Date().toISOString(),
    kind: 'LOCAL_DESIGN_ARTIFACT_ONLY',
    sourceRevision: expected.sourceRevision,
    databaseName: dbName,
    serverVersion: await scalar(
      "SELECT current_setting('server_version') AS value",
    ),
    tests,
  };
  await writeFile(
    resolve(here, 'validation-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: tests.length, databaseName: dbName }));
} finally {
  await pool.end();
}
