/**
 * Fills known Dominican bank domains and downloads missing brand logos.
 * Safe to re-run: it only sets domain when it is still empty, and only
 * downloads a file when logo_path is null.
 *
 *   pnpm db:backfill-logos
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { LogoService } from '../../src/modules/logos/application/logo.service';
import { getPrismaClientClass } from '../../src/prisma/generated/internal/class';
import {
  defaultRejectUnauthorized,
  poolConfigForPostgresUrl,
} from '../../src/prisma/pg-pool.config';

const DOMAIN_RULES: { test: RegExp; domain: string }[] = [
  { test: /bhd/i, domain: 'bhd.com.do' },
  { test: /banreservas/i, domain: 'banreservas.com' },
  { test: /popular/i, domain: 'popularenlinea.com' },
];

const PrismaClient = getPrismaClientClass();

function domainForName(name: string): string | null {
  return DOMAIN_RULES.find((rule) => rule.test.test(name))?.domain ?? null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const pool = new Pool(
    poolConfigForPostgresUrl(databaseUrl, {
      rejectUnauthorized: defaultRejectUnauthorized(process.env.NODE_ENV, undefined),
      ca: process.env.DATABASE_SSL_CA,
    }),
  );
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const logos = new LogoService({
    get: (key: string) => process.env[key],
  } as ConstructorParameters<typeof LogoService>[0]);

  const institutions = await prisma.finInstitution.findMany({
    select: { id: true, name: true, domain: true, logoPath: true },
  });

  let domainsSet = 0;
  let logosStored = 0;
  for (const institution of institutions) {
    const domain = institution.domain ?? domainForName(institution.name);
    if (!institution.domain && domain) {
      await prisma.finInstitution.update({
        where: { id: institution.id },
        data: { domain },
      });
      domainsSet += 1;
    }
    if (domain && !institution.logoPath) {
      const logoPath = await logos.ensureLogo(domain);
      if (logoPath) {
        await prisma.finInstitution.update({
          where: { id: institution.id },
          data: { logoPath },
        });
        logosStored += 1;
      }
    }
  }

  await logos.ensureCardNetworks();
  console.log(
    `Institutions: ${institutions.length}. Domains set: ${domainsSet}. Logos stored: ${logosStored}.`,
  );
  await prisma.$disconnect();
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
