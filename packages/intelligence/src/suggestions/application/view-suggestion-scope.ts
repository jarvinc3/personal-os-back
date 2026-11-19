import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

const ROUTE_PREFIX = '/';
const VIEW_PREFIX = 'view:';
const SHEET_PREFIX = 'sheet:';

export type ViewSuggestionScope = {
  route: string;
  viewKey: string;
};

/**
 * La vista se identifica por ruta más vista o sheet, sin filtros ni entidad: así
 * el descarte aguanta cambios de mes o de selección.
 */
export function resolveViewSuggestionScope({
  route,
  view,
  sheet,
}: {
  route: string;
  view?: string;
  sheet?: string;
}): ViewSuggestionScope {
  if (view !== undefined && sheet !== undefined) {
    throw new BadRequestException('Indicá vista o sheet, no ambos');
  }
  const normalizedRoute = route.trim();
  if (!normalizedRoute.startsWith(ROUTE_PREFIX)) {
    throw new BadRequestException('La ruta debe empezar con /');
  }
  const normalizedView = view?.trim();
  const normalizedSheet = sheet?.trim();
  const viewKey = normalizedSheet
    ? `${SHEET_PREFIX}${normalizedSheet}`
    : normalizedView
      ? `${VIEW_PREFIX}${normalizedView}`
      : '';
  return { route: normalizedRoute, viewKey };
}

/** Identidad estable de una sugerencia dentro de su vista, para no resucitarla. */
export function viewSuggestionKey(label: string): string {
  return createHash('sha256')
    .update(label.trim().toLowerCase().replace(/\s+/g, ' '))
    .digest('hex');
}
