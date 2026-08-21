import {
  ExpenseCategoryOptions,
  type ExpenseCategory,
  type IncomeCategory,
} from "./categories";

export type TransactionType = "income" | "expense";

type BaseTransaction = {
  id: number;
  dateISO: string;
  amountCents: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  notes: string | null;
};

export type IncomeTransaction = BaseTransaction & {
  type: "income";
  category: IncomeCategory | null;
  distanceMeters: number | null;
};

export type ExpenseTransaction = BaseTransaction & {
  type: "expense";
  category: ExpenseCategory | null;
  distanceMeters: number | null;
};

export type Transaction = IncomeTransaction | ExpenseTransaction;

export type PeriodStats = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  expenseByCategoryCents: Record<ExpenseCategory, number>;
  uncategorizedCents: number;
  km: number;
  netPerKm: number | null; //Lucro/Km
  costPerKm: number | null; //Custo/Km
};

function categoryMap(): Record<ExpenseCategory, number> {
  return Object.fromEntries(
    ExpenseCategoryOptions.map((c) => [c.key, 0]),
  ) as Record<ExpenseCategory, number>;
}

export function computePeriodStats(transactions: Transaction[]): PeriodStats {
  let incomeCents = 0;
  let expenseCents = 0;
  let kmMeters = 0;
  const expenseByCategoryCents = categoryMap();
  let uncategorizedCents = 0;

  for (const t of transactions) {
    if (t.type === "income") {
      incomeCents += t.amountCents;

      if (typeof t.distanceMeters === "number" && t.distanceMeters > 0) {
        kmMeters += t.distanceMeters;
      }
      continue;
    }
    //expense
    expenseCents += t.amountCents;

    const cat = t.category;

    // Se a categoria for nula ou não estiver presente no mapa, contabiliza como "uncategorized"
    if (
      cat &&
      Object.prototype.hasOwnProperty.call(expenseByCategoryCents, cat)
    ) {
      expenseByCategoryCents[cat] += t.amountCents;
    } else {
      uncategorizedCents += t.amountCents;
    }
  }

  const netCents = incomeCents - expenseCents;
  const km = kmMeters / 1000;

  const netPerKm = km > 0 ? netCents / 100 / km : null;
  const costPerKm = km > 0 ? expenseCents / 100 / km : null;

  return {
    incomeCents,
    expenseCents,
    netCents,
    expenseByCategoryCents,
    uncategorizedCents,
    km,
    netPerKm,
    costPerKm,
  };
}
