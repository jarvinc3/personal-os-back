import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { Prisma } from '@personal-os/database';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { decimalToString } from '../../shared/domain/mappers';
import { normalizeAliasList } from '../domain/merchant-aliases';
import {
  merchantDisplayName,
  normalizeMerchant,
} from '../domain/normalize-merchant';
import {
  MerchantsRepository,
  type MerchantSpend,
} from '../infrastructure/merchants.repository';
import type { CreateMerchantDto } from '../presentation/dto/create-merchant.dto';
import type { ListMerchantsQueryDto } from '../presentation/dto/list-merchants-query.dto';
import type { UpdateMerchantDto } from '../presentation/dto/update-merchant.dto';

export type ResolvedMerchant = {
  id: string;
  name: string;
  normalizedKey: string;
  categoryId: string | null;
};

type MerchantRow = {
  id: string;
  name: string;
  normalizedKey: string;
  aliases: string[];
  categoryId: string | null;
  logoUrl: string | null;
  createdAt: Date;
};

/** The `dateTo` bound is a calendar day, so it must cover the whole day. */
function endOfDay(value: string): Date {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function monthRange(query: { dateFrom?: string; dateTo?: string }, now: Date) {
  if (query.dateFrom && query.dateTo) {
    return { from: new Date(query.dateFrom), to: endOfDay(query.dateTo) };
  }
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
  );
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
  );
  return { from, to };
}

function mapMerchant(row: MerchantRow, spend: MerchantSpend | undefined) {
  return {
    id: row.id,
    name: row.name,
    normalizedKey: row.normalizedKey,
    aliases: row.aliases,
    categoryId: row.categoryId,
    logoUrl: row.logoUrl,
    createdAt: row.createdAt.toISOString(),
    monthSpend: decimalToString(spend?.spend ?? 0),
    monthMovements: spend?.movements ?? 0,
  };
}

const MAX_MERCHANT_NAME_LENGTH = 120;

/** Typed text is kept as written; bank descriptors get a clean display name. */
function visibleMerchantName(input: {
  displayName?: string | null;
  rawName: string | null | undefined;
  normalizedKey: string;
}): string {
  const typed = input.displayName?.replace(/\s+/g, ' ').trim();
  if (typed) {
    return typed.slice(0, MAX_MERCHANT_NAME_LENGTH);
  }
  return merchantDisplayName(input.rawName) ?? input.normalizedKey;
}

@Injectable()
export class MerchantsService {
  constructor(
    private readonly repo: MerchantsRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly logos: LogoService,
  ) {}

  async list(userId: string, query: ListMerchantsQueryDto, now = new Date()) {
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.listMerchants(userId, {
      cursor,
      take: limit + 1,
      search: query.search,
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.createdAt.toISOString(),
    );
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      page.items.map((row) => row.id),
      monthRange(query, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    return {
      ...page,
      items: page.items.map((row) =>
        mapMerchant(row, spendByMerchant.get(row.id)),
      ),
    };
  }

  async get(userId: string, id: string, now = new Date()) {
    const merchant = await this.repo.findMerchantById(userId, id);
    if (!merchant) {
      throw new NotFoundException('Comercio no encontrado');
    }
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      [id],
      monthRange({}, now),
    );
    return mapMerchant(merchant, spends[0]);
  }

  /** Merchants with the same shape as `get`, in batch and without throwing. */
  async lookupMerchants(
    userId: string,
    ids: readonly string[],
    now = new Date(),
  ) {
    const rows = await this.repo.findMerchantsByIds(userId, ids);
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      rows.map((row) => row.id),
      monthRange({}, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        mapMerchant(row, spendByMerchant.get(row.id)),
      ]),
    );
  }

  async create(userId: string, dto: CreateMerchantDto, now = new Date()) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException(
        'El nombre del comercio no tiene texto utilizable',
      );
    }
    const normalizedKey = normalizeMerchant(name);
    if (!normalizedKey) {
      throw new BadRequestException(
        'El nombre del comercio no tiene texto utilizable',
      );
    }
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    try {
      const created = await this.repo.createMerchant(userId, {
        name,
        normalizedKey,
        aliases: normalizeAliasList(dto.aliases ?? []),
      });
      return this.get(userId, created.id, now);
    } catch (error) {
      await this.throwNameConflict(error, userId, normalizedKey);
    }
  }

  async update(userId: string, id: string, dto: UpdateMerchantDto) {
    const existing = await this.repo.findMerchantById(userId, id);
    if (!existing) {
      throw new NotFoundException('Comercio no encontrado');
    }
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const changes: {
      name?: string;
      normalizedKey?: string;
      categoryId?: string | null;
      logoUrl?: string | null;
    } = {};
    if (dto.name !== undefined) {
      const normalizedKey = normalizeMerchant(dto.name);
      if (!normalizedKey) {
        throw new BadRequestException(
          'El nombre del comercio no tiene texto utilizable',
        );
      }
      changes.name = dto.name.trim();
      changes.normalizedKey = normalizedKey;
    }
    if (dto.categoryId !== undefined) {
      changes.categoryId = dto.categoryId;
    }
    if (dto.logoUrl !== undefined) {
      changes.logoUrl = dto.logoUrl?.trim() || null;
    }
    try {
      await this.repo.updateMerchant(userId, id, changes);
    } catch (error) {
      await this.throwNameConflict(
        error,
        userId,
        changes.normalizedKey ?? existing.normalizedKey,
      );
    }
    return this.get(userId, id);
  }

  async merge(userId: string, id: string, targetId: string, now = new Date()) {
    if (id === targetId) {
      throw new BadRequestException(
        'No se puede fusionar un comercio consigo mismo',
      );
    }
    const merged = await this.repo.mergeMerchants(userId, id, targetId);
    if (!merged) {
      throw new NotFoundException('Comercio no encontrado');
    }
    return this.get(userId, targetId, now);
  }

  async uploadLogo(
    userId: string,
    id: string,
    file: LogoUploadFile | undefined,
    now = new Date(),
  ) {
    if (!file) {
      throw new BadRequestException('Archivo obligatorio');
    }
    const existing = await this.repo.findMerchantById(userId, id);
    if (!existing) {
      throw new NotFoundException('Comercio no encontrado');
    }
    let url: string | null;
    try {
      const path = await this.logos.saveCustomLogo(userId, id, file);
      url = this.logos.publicUrl(path);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo guardar el logo',
      );
    }
    await this.repo.updateMerchant(userId, id, { logoUrl: url });
    return this.get(userId, id, now);
  }

  /** Resolves (creating when needed) the canonical merchant for raw text. */
  resolve(userId: string, rawName: string | null | undefined) {
    return this.resolveMerchant({ userId, rawName });
  }

  /** Resolves text the user typed, keeping its capitalisation as the name. */
  resolveTyped(userId: string, typedName: string | null | undefined) {
    return this.resolveMerchant({
      userId,
      rawName: typedName,
      displayName: typedName,
    });
  }

  private async resolveMerchant({
    userId,
    rawName,
    displayName,
  }: {
    userId: string;
    rawName: string | null | undefined;
    displayName?: string | null;
  }): Promise<ResolvedMerchant | null> {
    const normalizedKey = normalizeMerchant(rawName);
    if (!normalizedKey) {
      return null;
    }
    const existing = await this.repo.findMerchantByKey(userId, normalizedKey);
    if (existing) {
      await this.appendAlias(userId, existing.id, existing.aliases, rawName);
      return this.toResolved(existing);
    }
    const name = visibleMerchantName({
      displayName,
      rawName,
      normalizedKey,
    });
    try {
      const created = await this.repo.createMerchant(userId, {
        name,
        normalizedKey,
        aliases: rawName ? [rawName] : [],
      });
      return this.toResolved(created);
    } catch (error) {
      return this.throwNameConflict(error, userId, normalizedKey);
    }
  }

  /** Best existing merchant for a typed name, to suggest its category. */
  async suggest(userId: string, rawName: string | null | undefined) {
    const normalizedKey = normalizeMerchant(rawName);
    if (!normalizedKey) {
      return null;
    }
    const exact = await this.repo.findMerchantByKey(userId, normalizedKey);
    const candidate =
      exact ?? (await this.repo.findMerchantByKeyPrefix(userId, normalizedKey));
    if (!candidate) {
      return null;
    }
    return {
      merchantId: candidate.id,
      name: candidate.name,
      categoryId: candidate.categoryId,
    };
  }

  private toResolved(row: {
    id: string;
    name: string;
    normalizedKey: string;
    categoryId: string | null;
  }): ResolvedMerchant {
    return {
      id: row.id,
      name: row.name,
      normalizedKey: row.normalizedKey,
      categoryId: row.categoryId,
    };
  }

  private async appendAlias(
    userId: string,
    id: string,
    aliases: string[],
    rawName: string | null | undefined,
  ): Promise<void> {
    if (!rawName || aliases.includes(rawName)) {
      return;
    }
    await this.repo.updateMerchant(userId, id, {
      aliases: [...aliases, rawName],
    });
  }

  /** 409 with the merchant that already holds the key, so the web can open it. */
  private async throwNameConflict(
    error: unknown,
    userId: string,
    normalizedKey: string,
  ): Promise<never> {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await this.repo.findMerchantByKey(userId, normalizedKey);
      throw new ConflictException({
        message: 'Ya existe un comercio con ese nombre',
        existingMerchantId: existing?.id ?? null,
      });
    }
    throw error;
  }
}
