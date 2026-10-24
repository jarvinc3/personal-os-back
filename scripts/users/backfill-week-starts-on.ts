import { createScriptPrismaClient } from '@personal-os/database';
import { type WeekStartsOn } from '../../packages/users/src/domain/defaults/global-preferences-defaults';
import { isWeekStartsOn } from '../../packages/users/src/domain/week-starts-on';

const MODULE_SLUGS = ['finance', 'agenda'] as const;
/** Module configs shipped with Monday as the stored first day. */
const MODULE_DEFAULT_WEEK_STARTS_ON = 1;

type ModuleSlug = (typeof MODULE_SLUGS)[number];

type ModuleWeekStart = {
  slug: ModuleSlug;
  weekStartsOn: WeekStartsOn;
};

type CandidateUser = {
  userId: string;
  preferences: unknown;
  moduleWeekStarts: ModuleWeekStart[];
};

function readModuleWeekStart(
  slug: ModuleSlug,
  config: unknown,
): ModuleWeekStart | null {
  if (typeof config !== 'object' || config === null) {
    return null;
  }
  const weekStartsOn = (config as { weekStartsOn?: unknown }).weekStartsOn;
  if (!isWeekStartsOn(weekStartsOn)) {
    return null;
  }
  return { slug, weekStartsOn };
}

/**
 * Agenda wins when both modules disagree: the calendar is where the week start
 * is used most.
 */
function pickWeekStart(
  values: readonly ModuleWeekStart[],
): WeekStartsOn | null {
  const agenda = values.find((value) => value.slug === 'agenda');
  if (agenda && agenda.weekStartsOn !== MODULE_DEFAULT_WEEK_STARTS_ON) {
    return agenda.weekStartsOn;
  }
  const finance = values.find((value) => value.slug === 'finance');
  if (finance && finance.weekStartsOn !== MODULE_DEFAULT_WEEK_STARTS_ON) {
    return finance.weekStartsOn;
  }
  return null;
}

function hasStoredWeekStart(preferences: unknown): boolean {
  if (typeof preferences !== 'object' || preferences === null) {
    return false;
  }
  const regional = (preferences as { regional?: unknown }).regional;
  if (typeof regional !== 'object' || regional === null) {
    return false;
  }
  return isWeekStartsOn((regional as { weekStartsOn?: unknown }).weekStartsOn);
}

function withWeekStart(
  preferences: unknown,
  weekStartsOn: WeekStartsOn,
): Record<string, unknown> {
  const base =
    typeof preferences === 'object' && preferences !== null
      ? (preferences as Record<string, unknown>)
      : {};
  const regional =
    typeof base.regional === 'object' && base.regional !== null
      ? (base.regional as Record<string, unknown>)
      : {};
  return { ...base, regional: { ...regional, weekStartsOn } };
}

/**
 * Copies the first day of the week stored per module into the global profile
 * preference. Users already migrated are skipped, so it is safe to rerun.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();

  const rows = await prisma.userModule.findMany({
    where: { module: { slug: { in: [...MODULE_SLUGS] } } },
    select: {
      userId: true,
      config: true,
      module: { select: { slug: true } },
      user: { select: { preferences: true } },
    },
  });

  const candidates = new Map<string, CandidateUser>();
  for (const row of rows) {
    const moduleWeekStart = readModuleWeekStart(
      row.module.slug as ModuleSlug,
      row.config,
    );
    if (!moduleWeekStart) {
      continue;
    }
    const candidate = candidates.get(row.userId) ?? {
      userId: row.userId,
      preferences: row.user.preferences,
      moduleWeekStarts: [],
    };
    candidate.moduleWeekStarts.push(moduleWeekStart);
    candidates.set(row.userId, candidate);
  }

  let migrated = 0;
  let skipped = 0;
  for (const candidate of candidates.values()) {
    const target = pickWeekStart(candidate.moduleWeekStarts);
    if (target === null || hasStoredWeekStart(candidate.preferences)) {
      skipped += 1;
      continue;
    }

    process.stdout.write(
      `${dryRun ? '[dry-run] ' : ''}user=${candidate.userId} weekStartsOn=${target}\n`,
    );
    if (!dryRun) {
      await prisma.user.update({
        where: { id: candidate.userId },
        data: {
          preferences: withWeekStart(candidate.preferences, target),
        },
      });
    }
    migrated += 1;
  }

  process.stdout.write(
    `${dryRun ? 'Would migrate' : 'Migrated'} ${migrated} users; skipped ${skipped}\n`,
  );
  await prisma.$disconnect();
}

void main();
