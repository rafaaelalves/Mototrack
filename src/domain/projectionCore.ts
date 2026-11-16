/**
 * Projeção limitada de receitas variáveis a partir do que já foi registrado.
 *
 * Despesas futuras, salário ainda não lançado e turnos agendados NÃO podem
 * ser inferidos do histórico de transações. Nunca chamar o resultado de
 * "saldo estimado" ou "lucro final do mês".
 */
export type ProjectionEntry = {
  type: "income" | "expense";
  amountCents: number;
};

export type MonthlyIncomeProjection = {
  observedIncomeCents: number;
  observedExpenseCents: number;
  runRateIncomeCents: number;
  nonProjectedIncomeCents: number;
  projectedRunRateIncomeCents: number;
  projectedIncomeCents: number;
  avgRunRateIncomePerDayCents: number;
};

type Input<T extends ProjectionEntry> = {
  transactions: readonly T[];
  elapsedDays: number;
  daysInMonth: number;
  isRunRateIncome: (entry: T) => boolean;
};

export function projectRecordedIncome<T extends ProjectionEntry>({
  transactions,
  elapsedDays,
  daysInMonth,
  isRunRateIncome,
}: Input<T>): MonthlyIncomeProjection {
  if (
    !Number.isInteger(daysInMonth) || daysInMonth < 28 || daysInMonth > 31 ||
    !Number.isInteger(elapsedDays) || elapsedDays < 1 ||
    elapsedDays > daysInMonth
  ) {
    throw new Error("Dias do mês e dias decorridos devem formar um período válido.");
  }

  let runRateIncomeCents = 0;
  let nonProjectedIncomeCents = 0;
  let observedExpenseCents = 0;

  for (const entry of transactions) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0) {
      throw new Error("Lançamento com valor inválido em centavos.");
    }

    if (entry.type === "expense") {
      observedExpenseCents += entry.amountCents;
    } else if (isRunRateIncome(entry)) {
      runRateIncomeCents += entry.amountCents;
    } else {
      nonProjectedIncomeCents += entry.amountCents;
    }
  }

  const avgRunRateIncomePerDayCents = runRateIncomeCents / elapsedDays;
  const extraDays = daysInMonth - elapsedDays;
  const extraRunRateIncomeCents = Math.round(
    avgRunRateIncomePerDayCents * extraDays,
  );

  return {
    observedIncomeCents: runRateIncomeCents + nonProjectedIncomeCents,
    observedExpenseCents,
    runRateIncomeCents,
    nonProjectedIncomeCents,
    projectedRunRateIncomeCents: runRateIncomeCents + extraRunRateIncomeCents,
    projectedIncomeCents:
      runRateIncomeCents + nonProjectedIncomeCents + extraRunRateIncomeCents,
    avgRunRateIncomePerDayCents,
  };
}
