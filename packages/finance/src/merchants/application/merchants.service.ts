import { Injectable } from '@nestjs/common';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { MerchantsRepository } from '../infrastructure/merchants.repository';
import type { CreateMerchantDto } from '../presentation/dto/create-merchant.dto';
import type { ListMerchantsQueryDto } from '../presentation/dto/list-merchants-query.dto';
import type { UpdateMerchantDto } from '../presentation/dto/update-merchant.dto';
import { MerchantDirectory } from './merchant-directory';
import { MerchantDuplicates } from './merchant-duplicates';
import { MerchantLogos } from './merchant-logos';
import {
  MerchantResolver,
  type MerchantSuggestion,
  type ResolveMerchantInput,
  type ResolvedMerchant,
} from './merchant-resolver';
import { MerchantWrites } from './merchant-writes';
import type {
  MerchantDuplicateView,
  MerchantPageView,
  MerchantView,
} from './merchant-view';

export type { ResolveMerchantInput, ResolvedMerchant };

@Injectable()
export class MerchantsService {
  private readonly duplicateFinder: MerchantDuplicates;
  private readonly directory: MerchantDirectory;
  private readonly resolver: MerchantResolver;
  private readonly logoAssets: MerchantLogos;
  private readonly writes: MerchantWrites;

  constructor(
    private readonly repo: MerchantsRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly logos: LogoService,
  ) {
    this.duplicateFinder = new MerchantDuplicates(this.repo);
    this.directory = new MerchantDirectory({
      repo: this.repo,
      logos: this.logos,
      duplicates: this.duplicateFinder,
    });
    this.resolver = new MerchantResolver(this.repo);
    this.logoAssets = new MerchantLogos({
      repo: this.repo,
      logos: this.logos,
      directory: this.directory,
    });
    this.writes = new MerchantWrites({
      repo: this.repo,
      ownership: this.ownership,
      resolver: this.resolver,
      logos: this.logoAssets,
      directory: this.directory,
    });
  }

  list(
    userId: string,
    query: ListMerchantsQueryDto,
    now = new Date(),
  ): Promise<MerchantPageView> {
    return this.directory.list(userId, query, now);
  }

  get(userId: string, id: string, now = new Date()): Promise<MerchantView> {
    return this.directory.get(userId, id, now);
  }

  /** Merchants with the same shape as `get`, in batch and without throwing. */
  lookupMerchants(
    userId: string,
    ids: readonly string[],
    now = new Date(),
  ): Promise<Map<string, MerchantView>> {
    return this.directory.lookupMerchants(userId, ids, now);
  }

  duplicates(
    userId: string,
    id: string,
    now = new Date(),
  ): Promise<MerchantDuplicateView[]> {
    return this.duplicateFinder.list(userId, id, now);
  }

  dismissDuplicate(
    userId: string,
    id: string,
    otherId: string,
  ): Promise<{ dismissed: boolean }> {
    return this.duplicateFinder.dismiss(userId, id, otherId);
  }

  undoDismissDuplicate(
    userId: string,
    id: string,
    otherId: string,
  ): Promise<{ dismissed: boolean }> {
    return this.duplicateFinder.undoDismiss(userId, id, otherId);
  }

  create(
    userId: string,
    dto: CreateMerchantDto,
    now = new Date(),
  ): Promise<MerchantView> {
    return this.writes.create(userId, dto, now);
  }

  update(
    userId: string,
    id: string,
    dto: UpdateMerchantDto,
  ): Promise<MerchantView> {
    return this.writes.update(userId, id, dto);
  }

  merge(userId: string, id: string, targetId: string): Promise<MerchantView> {
    return this.writes.merge(userId, id, targetId);
  }

  uploadLogo(
    userId: string,
    id: string,
    file: LogoUploadFile | undefined,
  ): Promise<MerchantView> {
    return this.logoAssets.upload({ userId, id, file });
  }

  /** Removes the own upload, so the brand logo can show again. */
  deleteLogo(
    userId: string,
    id: string,
    now = new Date(),
  ): Promise<MerchantView> {
    return this.logoAssets.delete({ userId, id, now });
  }

  /** Resolves (creating when needed) the canonical merchant for raw text. */
  resolve(input: ResolveMerchantInput): Promise<ResolvedMerchant | null> {
    return this.resolver.resolve(input);
  }

  /** Resolves text the user typed, keeping its capitalisation as the name. */
  resolveTyped(input: ResolveMerchantInput): Promise<ResolvedMerchant | null> {
    return this.resolver.resolveTyped(input);
  }

  /** Best existing merchant for a typed name, to suggest its category. */
  suggest(
    userId: string,
    rawName: string | null | undefined,
  ): Promise<MerchantSuggestion | null> {
    return this.resolver.suggest(userId, rawName);
  }
}
