export const ExpenseCategoryOptions = [
  { key: "fuel", label: "Combustível" },
  { key: "food", label: "Alimentação" },
  { key: "maintenance", label: "Manutenção" },
  { key: "vehicle", label: "Veículo" },
  { key: "health", label: "Saúde" },
  { key: "other", label: "Outros" },
] as const;

export type ExpenseCategory = (typeof ExpenseCategoryOptions)[number]["key"];

export function expenseCategoryLabel(key: ExpenseCategory | null | undefined) {
  if (!key) return null;
  const found = ExpenseCategoryOptions.find((c) => c.key === key);
  return found?.label ?? null;
}

export const IncomeCategoryOptions = [
  { key: "salary", label: "Salário", projectionBehavior: "fixed" },
  { key: "delivery", label: "Entregas", projectionBehavior: "run_rate" },
  { key: "one_off", label: "Receita Única", projectionBehavior: "one_off" },
] as const;

export type IncomeCategory = (typeof IncomeCategoryOptions)[number]["key"];

export type IncomeProjectionBehavior =
  (typeof IncomeCategoryOptions)[number]["projectionBehavior"];

export function incomeCategoryLabel(key: IncomeCategory | null | undefined) {
  if (!key) return null;
  const found = IncomeCategoryOptions.find((c) => c.key === key);
  return found?.label ?? null;
}

export function incomeCategoryProjectionBehavior(
  key: IncomeCategory,
): IncomeProjectionBehavior {
  const category = IncomeCategoryOptions.find((c) => c.key === key);

  if (!category) {
    throw new Error(`Unknown income category: ${key}`);
  }

  return category.projectionBehavior;
}

export function isRunRateIncomeCategory(
  key: IncomeCategory | null | undefined,
): boolean {
  if (!key) {
    return false;
  }

  return incomeCategoryProjectionBehavior(key) === "run_rate";
}
