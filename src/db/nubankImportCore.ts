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
  pendingGroupCount: number;
};

export type ExistingTransactionMatch = {
  id: number;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  title: string;
  category: string | null;
  notes: string | null;
  createdAt: number;
  distanceMeters: number | null;
};

export type ReviewDecision = {
  itemId: number;
  action: ImportAction;
  category: ExpenseCategory | IncomeCategory | null;
  applyToSimilar: boolean;
  rememberRule: boolean;
};

type SqlConnection = Pick<SQLiteDatabase, "getFirstAsync" | "getAllAsync" | "runAsync">;

export type ImportBatchSummary = {
  createdAt: number;
  total: number;
  pending: number;
  imported: number;
  reviewed: number;
  firstDate: string;
  lastDate: string;
};

export type LearnedCategory = {
  category: string;
  count: number;
  exampleTitle: string;
};

export type GroupScope = "exact" | "brand";

/** Sufixo da loja no extrato: "DEBIT:OXXO PISCINAS" -> "DEBIT:OXXO". */
export function brandPrefix(merchantKey: string): string | null {
  // Para não agrupar Pix, transferências, "Mercado", "Posto" etc. indevidamente.
  if (!merchantKey.startsWith("DEBIT:")) return null;
  const name = merchantKey.slice(6).trim();
  const first = name.split(/\s+/)[0] || "";
  const generic = new Set([
    "MERCADO","MERCADOS","SUPERMERCADO","SUPERMERCADOS","POSTO",
    "LOJA","COMERCIO","COMERCIAL","AUTO","PAGAMENTO","COMPRA",
    "RESTAURANTE","LANCHONETE","PADARIA","FARMACIA",
  ]);
  if (first.length < 4 || generic.has(first) || !/^[A-Z0-9]+$/.test(first)) {
    return null;
  }
  return "DEBIT:" + first;
}

function selectionPredicate(scope: GroupScope, merchantKey: string) {
  const prefix = scope === "brand" ? brandPrefix(merchantKey) : null;
  if (scope === "brand" && !prefix) {
    throw new Error("Agrupamento por nome não é seguro para este estabelecimento.");
  }
  if (prefix) {
    return {
      clause: "(merchantKey=? OR (substr(merchantKey,1,?)=? AND substr(merchantKey,?+1,1)=' '))",
      values: [prefix, prefix.length, prefix, prefix.length],
    };
  }
  return { clause: "merchantKey=?", values: [merchantKey] };
}

/** Os lotes antigos já compartilham createdAt, atribuído uma vez por CSV. */
export async function listImportBatchesCore(db: SqlConnection): Promise<ImportBatchSummary[]> {
  return db.getAllAsync<ImportBatchSummary>(
    "SELECT createdAt, COUNT(*) AS total, " +
    "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, " +
    "SUM(CASE WHEN status='imported' THEN 1 ELSE 0 END) AS imported, " +
    "SUM(CASE WHEN status<>'pending' THEN 1 ELSE 0 END) AS reviewed, " +
    "MIN(dateISO) AS firstDate, MAX(dateISO) AS lastDate " +
    "FROM bank_import_rows WHERE source=? GROUP BY createdAt " +
    "HAVING SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)>0 " +
    "ORDER BY createdAt DESC;",
    [NUBANK_ACCOUNT_SOURCE],
  );
}

/**
 * Descartar revisão de um arquivo específico: apaga APENAS pendências.
 * Não toca em transações já aprovadas, ignoradas ou regras; as pendências
 * descartadas poderão ser importadas novamente pelo mesmo CSV.
 */
export async function cancelPendingBatchCore(
  db: SqlConnection,
  batchCreatedAt: number,
): Promise<{ cancelled: number; preservedReviewed: number }> {
  if (!Number.isSafeInteger(batchCreatedAt) || batchCreatedAt <= 0) {
    throw new Error("Lote de importação inválido.");
  }
  const summary = await db.getFirstAsync<{ pending: number; reviewed: number }>(
    "SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, " +
    "SUM(CASE WHEN status<>'pending' THEN 1 ELSE 0 END) AS reviewed " +
    "FROM bank_import_rows WHERE source=? AND createdAt=?;",
    [NUBANK_ACCOUNT_SOURCE, batchCreatedAt],
  );
  if (!summary || !summary.pending) {
    throw new Error("Este lote não possui mais movimentações pendentes.");
  }
  const outcome = await db.runAsync(
    "DELETE FROM bank_import_rows WHERE source=? AND createdAt=? AND status='pending';",
    [NUBANK_ACCOUNT_SOURCE, batchCreatedAt],
  );
  if (outcome.changes !== summary.pending) {
    throw new Error("O lote mudou durante o cancelamento. Operação revertida.");
  }
  return { cancelled: outcome.changes, preservedReviewed: summary.reviewed ?? 0 };
}

export async function getPendingCategoryGroupCore(
  db: SqlConnection,
  rowId: number,
  scope: GroupScope,
): Promise<{ count: number; label: string; examples: string[] }> {
  const item = await db.getFirstAsync<{ merchantKey: string; type: TransactionType }>(
    "SELECT merchantKey, type FROM bank_import_rows " +
    "WHERE id=? AND source=? AND status='pending';",
    [rowId, NUBANK_ACCOUNT_SOURCE],
  );
  if (!item) throw new Error("Movimentação pendente não encontrada.");
  const where = selectionPredicate(scope, item.merchantKey);
  const conditions = "source=? AND status='pending' AND category IS NULL " +
    "AND type=? AND " + where.clause;
  const params = [NUBANK_ACCOUNT_SOURCE, item.type, ...where.values];
  const result = await db.getFirstAsync<{ total: number }>(
    "SELECT COUNT(*) AS total FROM bank_import_rows WHERE " + conditions + ";",
    params,
  );
  const samples = await db.getAllAsync<{ merchantKey: string }>(
    "SELECT DISTINCT merchantKey FROM bank_import_rows WHERE " + conditions +
    " ORDER BY merchantKey LIMIT 5;",
    params,
  );
  return {
    count: result?.total ?? 0,
    label: scope === "brand" ? (brandPrefix(item.merchantKey) ?? item.merchantKey).slice(6) : item.merchantKey,
    examples: samples.map((sample) => sample.merchantKey),
  };
}

export async function categorizePendingGroupCore(
  db: SqlConnection,
  rowId: number,
  category: string,
  scope: GroupScope,
): Promise<number> {
  const item = await db.getFirstAsync<{ merchantKey: string; type: TransactionType }>(
    "SELECT merchantKey, type FROM bank_import_rows " +
    "WHERE id=? AND source=? AND status='pending';",
    [rowId, NUBANK_ACCOUNT_SOURCE],
  );
  if (!item) throw new Error("Movimentação pendente não encontrada.");
  validateCategory(item.type, "import", category);
  const where = selectionPredicate(scope, item.merchantKey);
  const result = await db.runAsync(
    "UPDATE bank_import_rows SET category=?, updatedAt=? WHERE source=? " +
    "AND status='pending' AND category IS NULL AND type=? AND " + where.clause + ";",
    [category, Date.now(), NUBANK_ACCOUNT_SOURCE, item.type, ...where.values],
  );
  return result.changes;
}

function normalizedTitle(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/^(DEBITO|PIX PARA|PIX DE):?\s*/, "")
    .replace(/[^A-Z0-9]+/g," ").trim();
}

/**
 * Aprendizado conservador: títulos históricos com prefixo igual ao nome da
 * loja, e TODOS da mesma direção/categoria. Divergência => sem sugestão.
 */
export async function getLearnedCategoryCore(
  db: SqlConnection,
  merchantKey: string,
  type: TransactionType,
): Promise<LearnedCategory | null> {
  const merchant = merchantKey.includes(":")
    ? merchantKey.slice(merchantKey.indexOf(":") + 1)
    : merchantKey;
  const normalized = normalizedTitle(merchant);
  const prefix = brandPrefix(merchantKey);
  const token = prefix ? prefix.slice(6) : normalized;
  if (!token || token.length < 4 || normalized === "CARD BILL") return null;
  const history = await db.getAllAsync<{
    title: string; category: string | null; n: number;
  }>(
    "SELECT title, category, COUNT(*) AS n FROM transactions " +
    "WHERE deletedAt IS NULL AND type=? AND category IS NOT NULL " +
    "GROUP BY title, category ORDER BY n DESC LIMIT 1200;",
    [type],
  );
  const matching = history.filter((r) => {
    const title = normalizedTitle(r.title);
    return title === token || title.startsWith(token + " ");
  });
  if (!matching.length) return null;
  const unique = [...new Set(matching.map((r) => r.category))];
  if (unique.length !== 1 || unique[0] === null) return null;
  const category = unique[0];
  if (type === "income" ? !ALLOWED_INCOME.has(category) : !ALLOWED_EXPENSE.has(category)) {
    return null;
  }
  return {
    category,
    count: matching.reduce((sum, r) => sum + r.n, 0),
    exampleTitle: matching[0].title,
  };
}


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
  offset = 0,
): Promise<BankImportItem[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Limite de listagem inválido.");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Deslocamento de página inválido.");
  }
  return db.getAllAsync<BankImportItem>(
    "SELECT b.*, r.action AS ruleAction, r.category AS ruleCategory, " +
    "(SELECT COUNT(*) FROM transactions t WHERE t.deletedAt IS NULL " +
    "AND t.dateISO=b.dateISO AND t.type=b.type AND t.amountCents=b.amountCents) " +
    "AS similarCount, " +
    "(SELECT COUNT(*) FROM bank_import_rows g " +
    "WHERE g.source=b.source AND g.status='pending' " +
    "AND g.merchantKey=b.merchantKey AND g.type=b.type) AS pendingGroupCount " +
    "FROM bank_import_rows b " +
    "LEFT JOIN bank_import_rules r ON r.source=b.source " +
    "AND r.merchantKey=b.merchantKey AND r.type=b.type " +
    "WHERE b.source=? AND b.status=? ORDER BY b.dateISO DESC, b.id DESC LIMIT ? OFFSET ?;",
    [NUBANK_ACCOUNT_SOURCE, status, limit, offset],
  );
}
export async function countPendingCore(db: SqlConnection): Promise<number> {
  const count = await db.getFirstAsync<{ total: number }>(
    "SELECT COUNT(*) AS total FROM bank_import_rows WHERE source=? AND status='pending';",
    [NUBANK_ACCOUNT_SOURCE],
  );
  return count?.total ?? 0;
}

/**
 * A mesma data, direção e valor são somente uma pista: a comparação exibe
 * os registros originais e não elimina nada automaticamente.
 */
export async function getExistingTransactionMatchesCore(
  db: SqlConnection,
  itemId: number,
  limit = 25,
): Promise<ExistingTransactionMatch[]> {
  if (!Number.isSafeInteger(itemId) || itemId < 1) {
    throw new Error("Movimentação inválida para comparação.");
  }
  const item = await db.getFirstAsync<{
    dateISO: string; type: TransactionType; amountCents: number;
  }>(
    "SELECT dateISO, type, amountCents FROM bank_import_rows " +
    "WHERE id=? AND source=? AND status='pending';",
    [itemId, NUBANK_ACCOUNT_SOURCE],
  );
  if (!item) return [];
  return db.getAllAsync<ExistingTransactionMatch>(
    "SELECT id, dateISO, type, amountCents, title, category, notes, " +
    "createdAt, distanceMeters FROM transactions " +
    "WHERE deletedAt IS NULL AND dateISO=? AND type=? AND amountCents=? " +
    "ORDER BY createdAt DESC, id DESC LIMIT ?;",
    [item.dateISO, item.type, item.amountCents, limit],
  );
}

/** Guarda uma categoria escolhida para revisão posterior, sem aprovar. */
export async function saveBankImportDraftCore(
  db: SqlConnection,
  itemId: number,
  category: string | null,
): Promise<void> {
  const item = await db.getFirstAsync<{ type: TransactionType }>(
    "SELECT type FROM bank_import_rows WHERE id=? AND source=? AND status='pending';",
    [itemId, NUBANK_ACCOUNT_SOURCE],
  );
  if (!item) throw new Error("Movimentação não está mais pendente.");
  if (category !== null) {
    const allowed = item.type === "income" ? ALLOWED_INCOME : ALLOWED_EXPENSE;
    if (!allowed.has(category)) throw new Error("Categoria de rascunho inválida.");
  }
  await db.runAsync(
    "UPDATE bank_import_rows SET category=?, updatedAt=? " +
    "WHERE id=? AND source=? AND status='pending';",
    [category, Date.now(), itemId, NUBANK_ACCOUNT_SOURCE],
  );
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
