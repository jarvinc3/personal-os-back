export const ENTITY_REF_TYPES = [
  'transaction',
  'transfer',
  'account',
  'card',
  'card_statement',
  'loan',
  'loan_installment',
  'receivable',
  'savings_goal',
  'budget',
  'institution',
  'email_message',
] as const;

export type EntityRefType = (typeof ENTITY_REF_TYPES)[number];

export type EntityRef = {
  type: EntityRefType;
  id: string;
};

export type ChatContext = {
  moduleSlug: string;
  screen?: string;
  entityRef?: EntityRef;
};

/** Context supplied by the active web route when opening or invoking the agent. */
export type AiInvocationContext = {
  route: string;
  view?: string;
  sheet?: string;
  entityRef?: EntityRef;
  filters?: Record<string, unknown>;
};

/**
 * Short, user-scoped snapshot of the entity a chat session refers to. Null when
 * the entity does not exist or belongs to another user.
 */
export type ChatContextEntity = {
  type: EntityRefType;
  id: string;
  name: string;
  summary: string;
};
