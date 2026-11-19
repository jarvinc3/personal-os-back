/**
 * Estados que la lista de correos admite como filtro (#414). El enum de la base
 * guarda además `CLASSIFYING` y `DISCARDED`, que no se filtran desde la lista.
 */
export const AI_EMAIL_MESSAGE_STATUS_FILTERS = [
  'INGESTED',
  'QUEUED',
  'PROCESSED',
  'REVIEW_REQUIRED',
  'FAILED',
] as const;

export type AiEmailMessageStatus =
  (typeof AI_EMAIL_MESSAGE_STATUS_FILTERS)[number];

export const INVALID_EMAIL_MESSAGE_STATUS_MESSAGE = `status debe ser uno de: ${AI_EMAIL_MESSAGE_STATUS_FILTERS.join(', ')}`;
