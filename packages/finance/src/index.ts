export { FinanceFacade } from './finance.facade';
export { FinanceEmailProductProposalCatalog } from './catalog/application/email-product-proposal-catalog';
export { FinanceAiCapabilities } from './ai/finance-ai-capabilities';
export { FinanceModule } from './finance.module';
export { FinanceSignalConsumer } from './signals/finance-signal-consumer';
export { FinanceEmailProductHints } from './ledger/application/email-product-hints.service';
export { FINANCE_SETTINGS_DESCRIPTOR } from './settings.descriptor';
export {
  FINANCE_NOTIFICATION_KEYS,
  FINANCE_SETTINGS_DEFAULTS,
  type FinanceNotificationKey,
} from './settings/finance-settings';
export { FinanceNotificationIntents } from './notifications/finance-notification-intents';
export {
  balanceDriftCopy,
  budgetThresholdCopy,
  cardPaymentDueCopy,
  cardStatementReminderCopy,
  formatNotificationAmount,
  recurringMissedCopy,
  recurringPriceChangedCopy,
  recurringUpcomingCopy,
  subscriptionRenewalDueCopy,
  transactionRecordedCopy,
  transactionUpdatedCopy,
  transferRecordedCopy,
  weeklySummaryCopy,
  type NotificationCopy,
  type TransactionNotificationFields,
} from './notifications/finance-notification-copy';
export * from './contracts';
export { FinanceStatementsModule } from './statements/statements.module';
export { STATEMENT_EXTRACTOR } from './statements/application/ports/statement-extractor.port';
export { STATEMENT_PDF_TEXT } from './statements/application/ports/statement-pdf.port';
export {
  FINANCE_DATA_BRANCHES,
  FINANCE_DATA_BRANCH_IDS,
  isFinanceDataBranch,
} from './shared/domain/finance-data-branches';
export {
  accountNumberLast4,
  decryptAccountNumber,
  encryptAccountNumber,
  fingerprintAccountNumber,
} from './shared/infrastructure/account-number-encryption.util';
