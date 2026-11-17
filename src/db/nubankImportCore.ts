import type { SQLiteDatabase } from "expo-sqlite";
import type {
  ImportAction,
  ImportStatus,
  NubankAccountRow,
} from "../domain/nubankCsv";
// Separado do parser para permitir testes Node sem resolver imports TS sem extensão.
const NUBANK_ACCOUNT_SOURCE = "nubank-account";
import type { ExpenseCategory, IncomeCategory } from "../domain/categories";
import type { TransactionType } from "../domain/transaction";

export type BankImportItem = {
  id: number;
  sourceId: string;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  description: string;
  merchantKey: string;
  suggestedCategory: string | null;
  suggestedAction: ImportAction | null;
  status: ImportStatus;
  category: string | null;
  transactionId: number | null;
  ruleAction: ImportAction | null;
  ruleCategory: string | null;
  similarCount: number;
};

export type ReviewDecision = {
  itemId: number;
  action: ImportAction;
  category: ExpenseCategory | IncomeCategory | null;
  applyToSimilar: boolean;
  rememberRule: boolean;
};

type SqlConnection = Pick<SQLiteDatabase, "getFirstAsync" | "getAllAsync" | "runAsync">;

const STAGING_INSERT =
  "INSERT INTO bank_import_rows (" +
  "source, sourceId, dateISO, type, amountCents, description, merchantKey, " +
  "suggestedCategory, suggestedAction, status, createdAt, updatedAt" +
  ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?);";

const IMPORT_TRANSACTION =
  "INSERT INTO transactions (" +
  "dateISO, type, amountCents, title, createdAt, updatedAt, deletedAt, " +
  "notes, category, distanceMeters) " +
  "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL);";

function provenance(sourceId: string): string {
  return "mototrack:nubank-account:" + sourceId;
}

const ALLOWED_INCOME = new Set(["salary", "delivery", "one_off"]);
const ALLOWED_EXPENSE = new Set(["fuel", "food", "maintenance", "vehicle", "health", "other"]);

function validateCategory(
  type: TransactionType,
  action: ImportAction,
  category: string | null,
): void {
  if (action !== "import") return;
  if (type === "income" && (!category || !ALLOWED_INCOME.has(category))) {
    throw new Error("Escolha uma categoria para a entrada antes de importar.");
  }
  if (type === "expense" && category !== null && !ALLOWED_EXPENSE.has(category)) {
    throw new Error("Categoria de despesa não reconhecida.");
  }
}

/** A transação é aberta pelo chamador. Não efetuar gravação sem confirmação. */
export async function stageNubankRowsCore(
  db: SqlConnection,
  rows: readonly NubankAccountRow[],
): Promise<{ created: number; repeated: number }> {
  let created = 0, repeated = 0;
  const now = Date.now();

  for (const row of rows) {
    const existing = await db.getFirstAsync<{
      dateISO: string; type: string; amountCents: number; merchantKey: string;
    }>(
      "SELECT dateISO, type, amountCents, merchantKey " +
      "FROM bank_import_rows WHERE source=? AND sourceId=?;",
      [NUBANK_ACCOUNT_SOURCE, row.sourceId],
    );
    if (existing) {
      // Mesmo UUID com valores diferentes não pode ser descartado silenciosamente.
      if (existing.dateISO !== row.dateISO || existing.type !== row.type ||
          existing.amountCents !== row.amountCents ||
          existing.merchantKey !== row.merchantKey) {
        throw new Error("Conflito: identificador " + row.sourceId +
          " já existe com outros dados. Nenhum registro foi alterado.");
      }
      repeated++;
      continue;
    }
    // Um backup JSON v1 preserva as notas das transações, mas não a fila.
    // Reencontrar o ID na nota impede duplicar importações após restaurar.
    const restored = await db.getFirstAsync<{
      id: number; deletedAt: number | null; category: string | null;
    }>(
      "SELECT id, deletedAt, category FROM transactions WHERE notes=? " +
      "ORDER BY (deletedAt IS NULL) DESC, id DESC LIMIT 1;",
      [provenance(row.sourceId)],
    );
    if (restored) {
      await db.runAsync(
        "INSERT INTO bank_import_rows (" +
        "source, sourceId, dateISO, type, amountCents, description, merchantKey, " +
        "suggestedCategory, suggestedAction, status, category, transactionId, createdAt, updatedAt) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        [
          NUBANK_ACCOUNT_SOURCE, row.sourceId, row.dateISO, row.type,
          row.amountCents, row.description, row.merchantKey,
          row.suggestedCategory, row.suggestedAction,
          restored.deletedAt === null ? "imported" : "ignored",
          restored.category, restored.id, now, now,
        ],
      );
      repeated++;
      continue;
    }
    await db.runAsync(STAGING_INSERT, [
      NUBANK_ACCOUNT_SOURCE, row.sourceId, row.dateISO, row.type,
      row.amountCents, row.description, row.merchantKey,
      row.suggestedCategory, row.suggestedAction, now, now,
    ]);
    created++;
  }
  return { created, repeated };
}

export async function listBankImportItemsCore(
  db: SqlConnection,
  status: ImportStatus = "pending",
  limit = 100,
): Promise<BankImportItem[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Limite de listagem inválido.");
  }
  return db.getAllAsync<BankImportItem>(
    "SELECT b.*, r.action AS ruleAction, r.category AS ruleCategory, " +
    "(SELECT COUNT(*) FROM transactions t WHERE t.deletedAt IS NULL " +
    "AND t.dateISO=b.dateISO AND t.type=b.type AND t.amountCents=b.amountCents) " +
    "AS similarCount FROM bank_import_rows b " +
    "LEFT JOIN bank_import_rules r ON r.source=b.source " +
    "AND r.merchantKey=b.merchantKey AND r.type=b.type " +
    "WHERE b.source=? AND b.status=? ORDER BY b.dateISO DESC, b.id DESC LIMIT ?;",
    [NUBANK_ACCOUNT_SOURCE, status, limit],
  );
}
export async function countPendingCore(db: SqlConnection): Promise<number> {
  const count = await db.getFirstAsync<{ total: number }>(
    "SELECT COUNT(*) AS total FROM bank_import_rows WHERE source=? AND status='pending';",
    [NUBANK_ACCOUNT_SOURCE],
  );
  return count?.total ?? 0;
}

/** Transação exclusiva/atômica aberta pelo chamador. */
export async function reviewBankItemCore(
  db: SqlConnection,
  decision: ReviewDecision,
): Promise<{ reviewed: number; rowIds: number[] }> {
  if (!Number.isSafeInteger(decision.itemId) || decision.itemId < 1) {
    throw new Error("Identificador de revisão inválido.");
  }
  const source = await db.getFirstAsync<BankImportItem>(
    "SELECT * FROM bank_import_rows WHERE id=? AND source=? AND status='pending';",
    [decision.itemId, NUBANK_ACCOUNT_SOURCE],
  );
  if (!source) throw new Error("Lançamento já revisado ou não encontrado.");
  if (!["import", "ignore", "transfer"].includes(decision.action)) {
    throw new Error("Ação de revisão inválida.");
  }
  validateCategory(source.type, decision.action, decision.category);

  const selected: BankImportItem[] = decision.applyToSimilar
    ? await db.getAllAsync<BankImportItem>(
        "SELECT * FROM bank_import_rows WHERE source=? AND status='pending' " +
        "AND merchantKey=? AND type=? ORDER BY id;",
        [NUBANK_ACCOUNT_SOURCE, source.merchantKey, source.type],
      )
    : [source];

  // Nunca importar um lote inteiro se algum item tiver possível duplicata
  // manual. O usuário pode revisá-los individualmente antes de confirmar.
  if (decision.applyToSimilar && decision.action === "import") {
    for (const row of selected) {
      const match = await db.getFirstAsync<{ total: number }>(
        "SELECT COUNT(*) AS total FROM transactions WHERE deletedAt IS NULL " +
        "AND dateISO=? AND type=? AND amountCents=?;",
        [row.dateISO, row.type, row.amountCents],
      );
      if ((match?.total ?? 0) > 0) {
        throw new Error(
          "Há possíveis duplicatas no grupo. Desmarque 'Aplicar às semelhantes' " +
          "e revise esses lançamentos individualmente.",
        );
      }
    }
  }

  const now = Date.now();
  const rowIds: number[] = [];
  for (const row of selected) {
    let transactionId: number | null = null;
    if (decision.action === "import") {
      const inserted = await db.runAsync(IMPORT_TRANSACTION, [
        row.dateISO, row.type, row.amountCents, row.description,
        now, now, provenance(row.sourceId), decision.category,
      ]);
      transactionId = inserted.lastInsertRowId;
    }
    const status: ImportStatus = decision.action === "import" ? "imported"
      : decision.action === "ignore" ? "ignored" : "transfer";
    const updated = await db.runAsync(
      "UPDATE bank_import_rows SET status=?, category=?, transactionId=?, updatedAt=? " +
      "WHERE id=? AND status='pending';",
      [status, decision.action === "import" ? decision.category : null,
        transactionId, now, row.id],
    );
    if (updated.changes !== 1) throw new Error("Conflito na revisão. Operação cancelada.");
    rowIds.push(row.id);
  }

  if (decision.rememberRule) {
    await db.runAsync(
      "INSERT INTO bank_import_rules (source, merchantKey, type, action, category, updatedAt) " +
      "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(source, merchantKey, type) DO UPDATE " +
      "SET action=excluded.action, category=excluded.category, updatedAt=excluded.updatedAt;",
      [NUBANK_ACCOUNT_SOURCE, source.merchantKey, source.type, decision.action,
        decision.action === "import" ? decision.category : null, now],
    );
  }
  return { reviewed: selected.length, rowIds };
}

/** Desfaz somente revisão cujo lançamento gerado ainda não foi alterado. */
export async function undoBankReviewCore(db: SqlConnection, rowId: number): Promise<void> {
  const row = await db.getFirstAsync<{
    id: number; status: ImportStatus; transactionId: number | null;
  }>("SELECT id, status, transactionId FROM bank_import_rows WHERE id=? AND source=?;",
    [rowId, NUBANK_ACCOUNT_SOURCE]);
  if (!row || row.status === "pending") throw new Error("Não existe revisão para desfazer.");
  const now = Date.now();
  if (row.status === "imported" && row.transactionId !== null) {
    const tx = await db.getFirstAsync<{ createdAt: number; updatedAt: number; deletedAt: number | null }>(
      "SELECT createdAt, updatedAt, deletedAt FROM transactions WHERE id=?;",
      [row.transactionId],
    );
    if (!tx || tx.createdAt !== tx.updatedAt || tx.deletedAt !== null) {
      throw new Error("Lançamento editado depois da importação. Revise-o manualmente.");
    }
    await db.runAsync(
      "UPDATE transactions SET deletedAt=?, updatedAt=? WHERE id=?;",
      [now, now, row.transactionId],
    );
  }
  await db.runAsync(
    "UPDATE bank_import_rows SET status='pending', category=NULL, transactionId=NULL, updatedAt=? WHERE id=?;",
    [now, rowId],
  );
}
