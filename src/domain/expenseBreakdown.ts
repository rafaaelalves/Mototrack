export type ExpenseBreakdownItem = {
  key: string;
  label: string;
  value: number;
};

/**
 * Apresenta até `maxSlices` setores sem perder parte das despesas.
 * Quando há mais categorias do que setores disponíveis, agrupa o restante
 * em "Outras categorias" para o donut sempre representar o total completo.
 *
 * Os valores são centavos inteiros, já agregados por categoria.
 */
export function buildExpenseBreakdown(
  rows: readonly ExpenseBreakdownItem[],
  maxSlices = 4,
): ExpenseBreakdownItem[] {
  if (!Number.isInteger(maxSlices) || maxSlices < 2) {
    throw new Error("O donut precisa permitir pelo menos dois setores.");
  }

  const positive = rows.filter(
    (item) => Number.isSafeInteger(item.value) && item.value > 0,
  );

  const sorted = [...positive].sort(
    (a, b) => b.value - a.value || a.key.localeCompare(b.key),
  );

  if (sorted.length <= maxSlices) return sorted;

  const visible = sorted.slice(0, maxSlices - 1);
  const groupedCents = sorted
    .slice(maxSlices - 1)
    .reduce((sum, item) => sum + item.value, 0);

  return [
    ...visible,
    { key: "remaining-categories", label: "Outras categorias", value: groupedCents },
  ];
}
