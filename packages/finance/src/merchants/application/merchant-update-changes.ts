import { BadRequestException } from '@nestjs/common';
import {
  MERCHANT_CATEGORY_SOURCE,
  type MerchantCategorySource,
} from '../domain/merchant-category-source';
import { normalizeMerchant } from '../domain/normalize-merchant';

export type MerchantUpdateChanges = {
  name?: string;
  normalizedKey?: string;
  categoryId?: string | null;
  categorySource?: MerchantCategorySource | null;
  domain?: string | null;
  logoPath?: string | null;
  customLogoPath?: string | null;
};

export function merchantNameChange(
  name: string | undefined,
): { name: string; normalizedKey: string } | null {
  if (name === undefined) {
    return null;
  }
  const normalizedKey = normalizeMerchant(name);
  if (!normalizedKey) {
    throw new BadRequestException(
      'El nombre del comercio no tiene texto utilizable',
    );
  }
  return { name: name.trim(), normalizedKey };
}

export function merchantCategoryChange(categoryId: string | null | undefined): {
  categoryId: string | null;
  categorySource: MerchantCategorySource | null;
} | null {
  if (categoryId === undefined) {
    return null;
  }
  // Sending the category, even the same one, is the user confirming it.
  return {
    categoryId,
    categorySource: categoryId ? MERCHANT_CATEGORY_SOURCE.MANUAL : null,
  };
}
