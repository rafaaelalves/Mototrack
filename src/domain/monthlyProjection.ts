import { incomeCategoryProjectionBehavior } from "./categories";
import type { Transaction } from "./transaction";

type MonthlyProjectionInput = {
  transactions: Transaction[];
  elapsedDays: number;
  daysInMonth: number;
};

export type MonthlyProjection = {
  projectedIncomeCents: number;
  projectedExpenseCents: number;
  projectedNetCents: number;

  runRateIncomeCents: number;
  nonProjectedIncomeCents: number;

  avgRunRateIncomePerDayCents: number;
  avgExpensePerDayCents: number;
};

export function calculateMonthlyProjection({
  transactions,
  elapsedDays,
  daysInMonth,
}: MonthlyProjectionInput): MonthlyProjection {
  const safeElapsedDays = Math.max(1, Math.min(elapsedDays, daysInMonth));

  let runRateIncomeCents = 0;
  let nonProjectedIncomeCents = 0;
  let expenseCents = 0;

  for (const transaction of transactions) {
    if (transaction.type === "expense") {
      expenseCents += transaction.amountCents;
      continue;
    }

    if (!transaction.category) {
      nonProjectedIncomeCents += transaction.amountCents;
      continue;
    }

    const behavior = incomeCategoryProjectionBehavior(transaction.category);

    if (behavior === "run_rate") {
      runRateIncomeCents += transaction.amountCents;
    } else {
      nonProjectedIncomeCents += transaction.amountCents;
    }
  }

  const avgRunRateIncomePerDayCents = runRateIncomeCents / safeElapsedDays;

  const avgExpensePerDayCents = expenseCents / safeElapsedDays;

  const projectedRunRateIncomeCents = Math.round(
    avgRunRateIncomePerDayCents * daysInMonth,
  );

  const projectedIncomeCents =
    projectedRunRateIncomeCents + nonProjectedIncomeCents;

  const projectedExpenseCents = Math.round(avgExpensePerDayCents * daysInMonth);

  return {
    projectedIncomeCents,
    projectedExpenseCents,
    projectedNetCents: projectedIncomeCents - projectedExpenseCents,

    runRateIncomeCents,
    nonProjectedIncomeCents,

    avgRunRateIncomePerDayCents,
    avgExpensePerDayCents,
  };
}
