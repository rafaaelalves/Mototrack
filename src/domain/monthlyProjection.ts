import { isRunRateIncomeCategory } from "./categories";
import {
  projectRecordedIncome,
  type MonthlyIncomeProjection,
} from "./projectionCore";
import type { Transaction } from "./transaction";

type MonthlyProjectionInput = {
  transactions: Transaction[];
  elapsedDays: number;
  daysInMonth: number;
};

export type MonthlyProjection = MonthlyIncomeProjection;

/**
 * Estima somente a renda variável registrada como run_rate (entregas).
 *
 * - Salário/receitas únicas já recebidos entram no total observado, sem
 *   extrapolação; salário ainda não lançado não é presumido.
 * - Despesas são somente observadas: faltam vencimentos e recorrências para
 *   produzir uma projeção honesta de saídas e de resultado final.
 * - Uma média diária de entregas é só uma aproximação inicial, não uma
 *   previsão baseada na disponibilidade real de turnos.
 */
export function calculateMonthlyProjection({
  transactions,
  elapsedDays,
  daysInMonth,
}: MonthlyProjectionInput): MonthlyProjection {
  return projectRecordedIncome({
    transactions,
    elapsedDays,
    daysInMonth,
    isRunRateIncome: (transaction) =>
      transaction.type === "income" &&
      isRunRateIncomeCategory(transaction.category),
  });
}
