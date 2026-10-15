export type WeeklySummaryTopCategory = {
  name: string;
  icon: string | null;
  color: string | null;
  total: string;
};

export type WeeklySummaryBudgetRisk = {
  id: string;
  name: string;
  pctUsed: number;
  spent: string;
  limit: string;
};

export type WeeklySummaryInstallment = {
  loanId: string;
  lenderName: string;
  amount: string;
  currency: string;
  dueDate: string;
};

export type WeeklySummaryCardDue = {
  cardId: string;
  name: string;
  lastFour: string | null;
  dueDay: number;
};

export type WeeklySummary = {
  weekStart: string;
  weekEnd: string;
  currency: string;
  expenses: string;
  averageExpenses: string;
  topCategories: WeeklySummaryTopCategory[];
  budgetsAtRisk: WeeklySummaryBudgetRisk[];
  upcomingInstallments: WeeklySummaryInstallment[];
  cardDueDates: WeeklySummaryCardDue[];
  pendingEmails: number;
};
