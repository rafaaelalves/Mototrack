import type { Transaction } from "./transaction";

/**
 * O formato de backup v1 é público e deve continuar legível. Backups antigos
 * podem omitir campos que ainda não existiam, mas nenhum valor inválido
 * pode chegar ao banco de dados.
 */
export type BackupFile = {
  version: 1;
  exportedAt: number;
  transactions: Transaction[];
};

const validIncomeCategories = new Set(["salary", "delivery", "one_off"]);
const validExpenseCategories = new Set([
  "fuel",
  "food",
  "maintenance",
  "vehicle",
  "health",
  "other",
]);

function objectAt(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} precisa ser um objeto.`);
  }
  return value as Record<string, unknown>;
}

function integerAt(value: unknown, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new Error(`${label} precisa ser um número inteiro válido.`);
  }
  return value as number;
}

function optionalInteger(
  value: unknown,
  label: string,
): number | null {
  return value === null || value === undefined
    ? null
    : integerAt(value, label);
}

function optionalText(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 50_000) {
    throw new Error(`${label} precisa ser um texto válido.`);
  }
  return value;
}

function validISODate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} deve ter o formato AAAA-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label} contém uma data inválida.`);
  }
  return value;
}

function parseTransaction(value: unknown, index: number): Transaction {
  const label = `Lançamento ${index + 1}`;
  const row = objectAt(value, label);

  const id = integerAt(row.id, `${label}: id`, 1);
  const dateISO = validISODate(row.dateISO, `${label}: data`);
  if (row.type !== "income" && row.type !== "expense") {
    throw new Error(`${label}: tipo de lançamento inválido.`);
  }

  const amountCents = integerAt(row.amountCents, `${label}: valor`);
  if (typeof row.title !== "string" || row.title.trim().length === 0 ||
      row.title.length > 10_000) {
    throw new Error(`${label}: descrição inválida.`);
  }

  const createdAt = integerAt(row.createdAt, `${label}: criação`);
  const updatedAt =
    row.updatedAt === undefined || row.updatedAt === null
      ? createdAt
      : integerAt(row.updatedAt, `${label}: atualização`);
  const deletedAt = optionalInteger(row.deletedAt, `${label}: exclusão`);
  const notes = optionalText(row.notes, `${label}: observações`);
  const distanceMeters = optionalInteger(
    row.distanceMeters,
    `${label}: distância`,
  );

  const categoryValue = row.category ?? null;
  if (categoryValue !== null && typeof categoryValue !== "string") {
    throw new Error(`${label}: categoria inválida.`);
  }
  const allowed = row.type === "income"
    ? validIncomeCategories
    : validExpenseCategories;
  if (categoryValue !== null && !allowed.has(categoryValue)) {
    throw new Error(
      `${label}: categoria não reconhecida (${categoryValue}). Não alteramos os dados automaticamente.`,
    );
  }

  // O discriminante type preserva os tipos da aplicação.
  return {
    id,
    dateISO,
    type: row.type,
    amountCents,
    title: row.title,
    createdAt,
    updatedAt,
    deletedAt,
    notes,
    category: categoryValue,
    distanceMeters,
  } as Transaction;
}

/**
 * Faz validação completa ANTES de qualquer DELETE/INSERT.
 * O objeto retornado contém cópias normalizadas dos lançamentos.
 */
export function parseBackupFile(input: unknown): BackupFile {
  const file = objectAt(input, "O backup");
  if (file.version !== 1) {
    throw new Error("Versão de backup incompatível. Esperada: 1.");
  }
  const exportedAt = integerAt(file.exportedAt, "Data de exportação");
  if (!Array.isArray(file.transactions)) {
    throw new Error("O backup não contém uma lista de lançamentos válida.");
  }

  const ids = new Set<number>();
  const transactions: Transaction[] = file.transactions.map((item, i) => {
    const transaction = parseTransaction(item, i);
    if (ids.has(transaction.id)) {
      throw new Error(
        `O backup contém IDs de lançamento repetidos (${transaction.id}).`,
      );
    }
    ids.add(transaction.id);
    return transaction;
  });
  return { version: 1, exportedAt, transactions };
}
