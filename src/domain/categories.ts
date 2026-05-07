export const CategoryOptions = [
  { key: "fuel", label: "Combustível" },
  { key: "food", label: "Alimentação" },
  { key: "maintenance", label: "Manutenção" },
  { key: "vehicle", label: "Veículo" },
  { key: "health", label: "Saúde" },
  { key: "other", label: "Outros" },
] as const;

export type TransactionCategory = (typeof CategoryOptions)[number]["key"];

export function categoryLabel(key: TransactionCategory | null | undefined) {
  if (!key) return null;
  const found = CategoryOptions.find((c) => c.key === key);
  return found?.label ?? null;
}
