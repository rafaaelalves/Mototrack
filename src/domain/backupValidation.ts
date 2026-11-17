import type { Transaction } from "./transaction";

/**
 * O formato de backup v1 é público e deve continuar legível. Backups antigos
 * podem omitir campos que ainda não existiam, mas nenhum valor inválido
 * pode chegar ao banco de dados.
 */
export type BankImportBackupRow = {
  id: number;
  source: string;
  sourceId: string;
  dateISO: string;
  type: "income" | "expense";
  amountCents: number;
  description: string;
  merchantKey: string;
  suggestedCategory: string | null;
  suggestedAction: "import" | "ignore" | "transfer" | null;
  status: "pending" | "imported" | "ignored" | "transfer";
  category: string | null;
  transactionId: number | null;
  createdAt: number;
  updatedAt: number;
};
export type BankImportRuleBackup = {
  id: number;
  source: string;
  merchantKey: string;
  type: "income" | "expense";
  action: "import" | "ignore" | "transfer";
  category: string | null;
  updatedAt: number;
};

export type BackupFile = {
  version: 1 | 2;
  exportedAt: number;
  transactions: Transaction[];
  bankImportRows: BankImportBackupRow[];
  bankImportRules: BankImportRuleBackup[];
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new Error(`${label} precisa ser um número inteiro válido.`);
  }
  return value;
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


const actions = new Set(["import", "ignore", "transfer"]);
const statuses = new Set(["pending", "imported", "ignored", "transfer"]);

function nonemptyText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(label + " precisa ser um texto válido.");
  }
  return value;
}

function validBankType(value: unknown, label: string): "income" | "expense" {
  if (value !== "income" && value !== "expense") {
    throw new Error(label + ": tipo inválido.");
  }
  return value;
}

function validBankCategory(
  category: unknown,
  type: "income" | "expense",
  label: string,
): string | null {
  if (category === null || category === undefined) return null;
  if (typeof category !== "string") throw new Error(label + ": categoria inválida.");
  const allowed = type === "income" ? validIncomeCategories : validExpenseCategories;
  if (!allowed.has(category)) throw new Error(label + ": categoria desconhecida.");
  return category;
}

function validBankAction(
  value: unknown,
  label: string,
  optional: boolean,
): "import" | "ignore" | "transfer" | null {
  if (optional && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || !actions.has(value)) {
    throw new Error(label + ": ação inválida.");
  }
  return value as "import" | "ignore" | "transfer";
}

function parseBankRow(value: unknown, index: number): BankImportBackupRow {
  const label = "Movimentação bancária " + (index + 1);
  const row = objectAt(value, label);
  const source = nonemptyText(row.source, label + " origem", 50);
  if (source !== "nubank-account") throw new Error(label + ": banco não suportado.");
  const sourceId = nonemptyText(row.sourceId, label + " identificador", 100);
  if (!/^[a-z0-9][a-z0-9_-]{7,99}$/i.test(sourceId)) {
    throw new Error(label + ": identificador externo inválido.");
  }
  const type = validBankType(row.type, label);
  const status = row.status;
  if (typeof status !== "string" || !statuses.has(status)) {
    throw new Error(label + ": estado inválido.");
  }
  const transactionId = optionalInteger(row.transactionId, label + " vínculo");
  if (status === "imported" && transactionId === null) {
    throw new Error(label + ": importado sem vínculo com transação.");
  }
  return {
    id: integerAt(row.id, label + " id", 1),
    source,
    sourceId,
    dateISO: validISODate(row.dateISO, label + " data"),
    type,
    amountCents: integerAt(row.amountCents, label + " valor", 1),
    description: nonemptyText(row.description, label + " descrição", 500),
    merchantKey: nonemptyText(row.merchantKey, label + " chave", 250),
    suggestedCategory: validBankCategory(row.suggestedCategory, type, label),
    suggestedAction: validBankAction(row.suggestedAction, label, true),
    status: status as BankImportBackupRow["status"],
    category: validBankCategory(row.category, type, label),
    transactionId,
    createdAt: integerAt(row.createdAt, label + " criação"),
    updatedAt: integerAt(row.updatedAt, label + " atualização"),
  };
}

function parseBankRule(value: unknown, index: number): BankImportRuleBackup {
  const label = "Regra " + (index + 1);
  const row = objectAt(value, label);
  const source = nonemptyText(row.source, label + " origem", 50);
  if (source !== "nubank-account") throw new Error(label + ": banco não suportado.");
  const type = validBankType(row.type, label);
  const action = validBankAction(row.action, label, false);
  if (action === null) throw new Error(label + ": regra sem ação.");
  const category = validBankCategory(row.category, type, label);
  if (action === "import" && type === "income" && category === null) {
    throw new Error(label + ": categoria de entrada obrigatória.");
  }
  return {
    id: integerAt(row.id, label + " id", 1),
    source,
    merchantKey: nonemptyText(row.merchantKey, label + " chave", 250),
    type,
    action,
    category,
    updatedAt: integerAt(row.updatedAt, label + " atualização"),
  };
}

/**
 * Faz validação completa ANTES de qualquer DELETE/INSERT.
 * O objeto retornado contém cópias normalizadas dos lançamentos.
 */
export function parseBackupFile(input: unknown): BackupFile {
  const file = objectAt(input, "O backup");
  if (file.version !== 1 && file.version !== 2) {
    throw new Error("Versão de backup incompatível. Esperadas: 1 ou 2.");
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
  if (file.version === 1) {
    return { version: 1, exportedAt, transactions, bankImportRows: [], bankImportRules: [] };
  }
  if (!Array.isArray(file.bankImportRows) || !Array.isArray(file.bankImportRules)) {
    throw new Error("Backup v2 precisa conter a fila de extratos e as regras.");
  }

  const rows = file.bankImportRows.map((value, i) => parseBankRow(value, i));
  const rules = file.bankImportRules.map((value, i) => parseBankRule(value, i));
  const rowIds = new Set<number>(), externalIds = new Set<string>();
  const ruleIds = new Set<number>(), ruleKeys = new Set<string>();

  for (const row of rows) {
    const external = row.source + ":" + row.sourceId;
    if (rowIds.has(row.id) || externalIds.has(external)) {
      throw new Error("Movimentação duplicada no backup v2.");
    }
    rowIds.add(row.id);
    externalIds.add(external);
    if (row.transactionId !== null && !ids.has(row.transactionId)) {
      throw new Error("Movimentação aponta para transação ausente no backup.");
    }
  }
  for (const rule of rules) {
    const key = rule.source + ":" + rule.merchantKey + ":" + rule.type;
    if (ruleIds.has(rule.id) || ruleKeys.has(key)) {
      throw new Error("Regra duplicada no backup v2.");
    }
    ruleIds.add(rule.id);
    ruleKeys.add(key);
  }

  return { version: 2, exportedAt, transactions, bankImportRows: rows, bankImportRules: rules };
}
