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
  resolutionReason: string | null;
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
  ignored: number;
  transfers: number;
  merged: number;
  reverted: number;
  cancelled: number;
  firstDate: string;
  lastDate: string;
};
export type ImportBatchEvent = {
  id: number;
  action: "pending_cancelled" | "approved_reversed";
  affectedCount: number;
  occurredAt: number;
};
export type ReversalCandidate = {
  rowId: number;
  transactionId: number;
  dateISO: string;
  amountCents: number;
  type: TransactionType;
  description: string;
};
export type BatchReversalPreview = {
  batchCreatedAt: number;
  reversible: ReversalCandidate[];
  blocked: { rowId: number; description: string; reason: string }[];
  alreadyInactive: number;
  incomeCents: number;
  expenseCents: number;
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

/**
 * Histórico completo, inclusive lotes concluídos ou cujas pendências foram
 * descartadas. Só os metadados de lote continuam após o cancelamento.
 */
export async function listImportBatchesCore(db: SqlConnection): Promise<ImportBatchSummary[]> {
  return db.getAllAsync<ImportBatchSummary>(
    "SELECT b.createdAt, b.originalCount AS total, b.cancelledCount AS cancelled, " +
    "b.firstDate, b.lastDate, " +
    "SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END) AS pending, " +
    "SUM(CASE WHEN r.status='imported' AND t.deletedAt IS NULL AND t.id IS NOT NULL THEN 1 ELSE 0 END) AS imported, " +
    "SUM(CASE WHEN r.status='imported' AND t.deletedAt IS NOT NULL THEN 1 ELSE 0 END) AS reverted, " +
    "SUM(CASE WHEN r.status='ignored' THEN 1 ELSE 0 END) AS ignored, " +
    "SUM(CASE WHEN r.status='transfer' THEN 1 ELSE 0 END) AS transfers, " +
    "SUM(CASE WHEN r.status='merged' THEN 1 ELSE 0 END) AS merged, " +
    "SUM(CASE WHEN r.status<>'pending' THEN 1 ELSE 0 END) AS reviewed " +
    "FROM bank_import_batches b " +
    "LEFT JOIN bank_import_rows r ON r.createdAt=b.createdAt AND r.source=b.source " +
    "LEFT JOIN transactions t ON t.id=r.transactionId " +
    "WHERE b.source=? GROUP BY b.createdAt ORDER BY b.createdAt DESC;",
    [NUBANK_ACCOUNT_SOURCE],
  );
}

export async function listImportBatchEventsCore(
  db: SqlConnection,
  batchCreatedAt: number,
): Promise<ImportBatchEvent[]> {
  return db.getAllAsync<ImportBatchEvent>(
    "SELECT id, action, affectedCount, occurredAt FROM bank_import_batch_events " +
    "WHERE source=? AND batchCreatedAt=? ORDER BY occurredAt DESC, id DESC;",
    [NUBANK_ACCOUNT_SOURCE, batchCreatedAt],
  );
}

/**
 * Descarta somente pendentes; o registro do lote e o evento de cancelamento
 * permanecem no backup v3 e no histórico.
 */
export async function cancelPendingBatchCore(
  db: SqlConnection,
  batchCreatedAt: number,
): Promise<{ cancelled: number; preservedReviewed: number }> {
  if (!Number.isSafeInteger(batchCreatedAt) || batchCreatedAt <= 0) {
    throw new Error("Lote de importação inválido.");
  }
  const batch = await db.getFirstAsync<{ createdAt: number }>(
    "SELECT createdAt FROM bank_import_batches WHERE createdAt=? AND source=?;",
    [batchCreatedAt, NUBANK_ACCOUNT_SOURCE],
  );
  if (!batch) throw new Error("Lote não encontrado.");
  const summary = await db.getFirstAsync<{ pending: number; reviewed: number }>(
    "SELECT COUNT(*) FILTER (WHERE status='pending') AS pending, " +
    "COUNT(*) FILTER (WHERE status<>'pending') AS reviewed " +
    "FROM bank_import_rows WHERE source=? AND createdAt=?;",
    [NUBANK_ACCOUNT_SOURCE, batchCreatedAt],
  );
  if (!summary?.pending) throw new Error("Este lote não possui mais movimentações pendentes.");
  const deleted = await db.runAsync(
    "DELETE FROM bank_import_rows WHERE source=? AND createdAt=? AND status='pending';",
    [NUBANK_ACCOUNT_SOURCE, batchCreatedAt],
  );
  if (deleted.changes !== summary.pending) {
    throw new Error("O lote mudou durante o cancelamento. Operação revertida.");
  }
  const now = Date.now();
  const updated = await db.runAsync(
    "UPDATE bank_import_batches SET cancelledCount=cancelledCount+?, lastActivityAt=? " +
    "WHERE createdAt=? AND source=?;",
    [deleted.changes, now, batchCreatedAt, NUBANK_ACCOUNT_SOURCE],
  );
  if (updated.changes !== 1) throw new Error("Lote alterado simultaneamente.");
  await db.runAsync(
    "INSERT INTO bank_import_batch_events " +
    "(source, batchCreatedAt, action, affectedCount, occurredAt) VALUES (?, ?, 'pending_cancelled', ?, ?);",
    [NUBANK_ACCOUNT_SOURCE, batchCreatedAt, deleted.changes, now],
  );
  return { cancelled: deleted.changes, preservedReviewed: summary.reviewed ?? 0 };
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
  const mostRecent = await db.getFirstAsync<{ latest: number | null }>(
    "SELECT MAX(createdAt) AS latest FROM bank_import_batches;",
  );
  const now = Math.max(Date.now(), (mostRecent?.latest ?? 0) + 1);
  let firstDate: string | null = null;
  let lastDate: string | null = null;

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
    if (firstDate === null || row.dateISO < firstDate) firstDate = row.dateISO;
    if (lastDate === null || row.dateISO > lastDate) lastDate = row.dateISO;
  }
  if (created > 0 && firstDate && lastDate) {
    await db.runAsync(
      "INSERT INTO bank_import_batches " +
      "(createdAt, source, firstDate, lastDate, originalCount, cancelledCount, lastActivityAt) " +
      "VALUES (?, ?, ?, ?, ?, 0, ?);",
      [now, NUBANK_ACCOUNT_SOURCE, firstDate, lastDate, created, now],
    );
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


export type SmartReviewStatus = "ready" | "duplicate" | "category" | "non_accounting";
export type SmartReviewRow = {
  id: number;
  sourceId: string;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  description: string;
  merchantKey: string;
  category: string | null;
  categoryOrigin: "manual" | "rule" | "pattern" | "history" | null;
  status: SmartReviewStatus;
  existingCount: number;
  nonAccountingHint: "transfer" | "ignore" | null;
};
export type SmartBatchAnalysis = {
  batchCreatedAt: number;
  count: number;
  ready: number;
  duplicate: number;
  category: number;
  nonAccounting: number;
  incomeCents: number;
  expenseCents: number;
  items: SmartReviewRow[];
};
export type SmartReadyPreview = {
  batchCreatedAt: number;
  entries: { id: number; category: string; type: TransactionType; amountCents: number }[];
  incomeCents: number;
  expenseCents: number;
};
export type SkipReason = "duplicate_rejected" | "not_relevant" |
  "own_transfer" | "already_recorded_card_payment" | "other_non_accounting";

function validExplicitCategory(type: TransactionType, category: string): boolean {
  return type === "income" ? ALLOWED_INCOME.has(category) : ALLOWED_EXPENSE.has(category);
}

/** Nenhuma gravação: classificação automática é sempre uma proposta revisável. */
export async function analyzeSmartBatchCore(
  db: SqlConnection,
  createdAt: number,
): Promise<SmartBatchAnalysis> {
  if (!Number.isSafeInteger(createdAt) || createdAt < 1) {
    throw new Error("Extrato inválido.");
  }
  const exists = await db.getFirstAsync<{ createdAt: number }>(
    "SELECT createdAt FROM bank_import_batches WHERE source=? AND createdAt=?;",
    [NUBANK_ACCOUNT_SOURCE, createdAt],
  );
  if (!exists) throw new Error("Extrato não encontrado.");
  type Candidate = BankImportItem & { bankSuggestedAction: ImportAction | null; existingCount: number };
  const records = await db.getAllAsync<Candidate>(
    "SELECT b.*, r.category AS ruleCategory, r.action AS ruleAction, " +
    "(SELECT COUNT(*) FROM transactions t WHERE t.deletedAt IS NULL " +
    "AND t.dateISO=b.dateISO AND t.type=b.type AND t.amountCents=b.amountCents) " +
    "AS existingCount FROM bank_import_rows b " +
    "LEFT JOIN bank_import_rules r ON r.source=b.source AND r.merchantKey=b.merchantKey " +
    "AND r.type=b.type WHERE b.source=? AND b.createdAt=? AND b.status='pending' " +
    "ORDER BY b.dateISO DESC, b.id DESC;",
    [NUBANK_ACCOUNT_SOURCE, createdAt],
  );
  // Duas compras distintas podem ter exatamente mesmo dia e valor.
  // Tratar ambas como exceções; não bloquear a confirmação do resto do CSV.
  const fingerprints = new Map<string,number>();
  for(const row of records){
    const key=row.dateISO+":"+row.type+":"+row.amountCents;
    fingerprints.set(key,(fingerprints.get(key)??0)+1);
  }
  const learning = new Map<string, LearnedCategory | null>();
  const items: SmartReviewRow[] = [];
  let ready=0, duplicate=0, category=0, nonAccounting=0;
  let incomeCents=0, expenseCents=0;
  for(const row of records) {
    let effectiveCategory: string | null = null;
    let origin: SmartReviewRow["categoryOrigin"] = null;
    for(const [value,from] of [
      [row.category,"manual"],[row.ruleCategory,"rule"],[row.suggestedCategory,"pattern"],
    ] as const) {
      if (value && validExplicitCategory(row.type,value)) {
        effectiveCategory=value; origin=from; break;
      }
    }
    const hint: SmartReviewRow["nonAccountingHint"] =
      row.category === null && (row.ruleAction==="transfer" || row.ruleAction==="ignore" ||
        row.suggestedAction==="transfer" || row.suggestedAction==="ignore")
        ? ((row.ruleAction === "ignore" || row.suggestedAction === "ignore") ? "ignore" : "transfer") : null;
    // Nunca usar aprendizado histórico para resolver automaticamente coincidências.
    if (!effectiveCategory && !hint && row.existingCount===0) {
      const lookup = row.type + ":" + row.merchantKey;
      if (!learning.has(lookup)) {
        learning.set(lookup, await getLearnedCategoryCore(db,row.merchantKey,row.type));
      }
      const found = learning.get(lookup);
      if (found && validExplicitCategory(row.type,found.category)) {
        effectiveCategory=found.category; origin="history";
      }
    }
    const status: SmartReviewStatus =
      (row.existingCount>0 || (fingerprints.get(row.dateISO+":"+row.type+":"+row.amountCents)??0)>1)
        ? "duplicate" :
      hint ? "non_accounting" :
      effectiveCategory ? "ready" : "category";
    if(status==="duplicate")duplicate++;
    else if(status==="non_accounting")nonAccounting++;
    else if(status==="category")category++;
    else {
      ready++;
      if(row.type==="income")incomeCents+=row.amountCents;
      else expenseCents+=row.amountCents;
    }
    items.push({
      id:row.id,sourceId:row.sourceId,dateISO:row.dateISO,
      type:row.type,amountCents:row.amountCents,
      description:row.description,merchantKey:row.merchantKey,
      category:effectiveCategory,categoryOrigin:origin,
      status,existingCount:row.existingCount,nonAccountingHint:hint,
    });
  }
  return { batchCreatedAt:createdAt,count:records.length,ready,duplicate,
    category,nonAccounting,incomeCents,expenseCents,items };
}

export function createReadyPreview(analysis: SmartBatchAnalysis): SmartReadyPreview {
  return {
    batchCreatedAt:analysis.batchCreatedAt,
    entries:analysis.items.filter(x=>x.status==="ready"&&x.category!==null)
      .map(x=>({id:x.id,category:x.category!,type:x.type,amountCents:x.amountCents})),
    incomeCents:analysis.incomeCents,expenseCents:analysis.expenseCents,
  };
}

function readyPreviewEquals(a:SmartReadyPreview,b:SmartReadyPreview):boolean {
  return a.batchCreatedAt===b.batchCreatedAt &&
    a.incomeCents===b.incomeCents && a.expenseCents===b.expenseCents &&
    JSON.stringify(a.entries)===JSON.stringify(b.entries);
}

/** Deve ser executado sob transação exclusiva: falha reverte o lote inteiro. */
export async function approveReadyBatchCore(
  db: SqlConnection,
  expected: SmartReadyPreview,
): Promise<{ created:number;incomeCents:number;expenseCents:number }> {
  if (!expected.entries.length)throw new Error("Não há lançamentos prontos.");
  const fresh=createReadyPreview(await analyzeSmartBatchCore(db,expected.batchCreatedAt));
  if (!readyPreviewEquals(fresh,expected)) {
    throw new Error("A análise mudou. Atualize a prévia antes de confirmar.");
  }
  const now=Date.now();
  for(const entry of fresh.entries) {
    const row=await db.getFirstAsync<{sourceId:string;description:string;dateISO:string;type:string;amountCents:number}>(
      "SELECT sourceId,description,dateISO,type,amountCents FROM bank_import_rows " +
      "WHERE id=? AND source=? AND createdAt=? AND status='pending';",
      [entry.id,NUBANK_ACCOUNT_SOURCE,expected.batchCreatedAt],
    );
    if(!row || row.type!==entry.type || row.amountCents!==entry.amountCents) {
      throw new Error("Movimentação modificada durante a confirmação.");
    }
    const possible=await db.getFirstAsync<{total:number}>(
      "SELECT COUNT(*) AS total FROM transactions WHERE deletedAt IS NULL " +
      "AND dateISO=? AND type=? AND amountCents=?;",
      [row.dateISO,row.type,row.amountCents],
    );
    if((possible?.total??0)!==0)throw new Error(
      "Possível duplicata encontrada durante a confirmação. Nenhum lançamento foi importado.",
    );
    const ins=await db.runAsync(IMPORT_TRANSACTION,[
      row.dateISO,row.type,row.amountCents,row.description,now,now,
      provenance(row.sourceId),entry.category,
    ]);
    const updated=await db.runAsync(
      "UPDATE bank_import_rows SET status='imported', category=?, " +
      "transactionId=?, resolutionReason=NULL, updatedAt=? " +
      "WHERE id=? AND source=? AND status='pending';",
      [entry.category,ins.lastInsertRowId,now,entry.id,NUBANK_ACCOUNT_SOURCE],
    );
    if(updated.changes!==1)throw new Error("Conflito ao confirmar movimentação.");
  }
  await db.runAsync(
    "UPDATE bank_import_batches SET lastActivityAt=? WHERE createdAt=? AND source=?;",
    [now,expected.batchCreatedAt,NUBANK_ACCOUNT_SOURCE],
  );
  return {created:fresh.entries.length,incomeCents:fresh.incomeCents,expenseCents:fresh.expenseCents};
}

/** Mesclar significa vincular comprovante bancário sem alterar o lançamento original. */
export async function mergeExistingBankRowCore(
  db:SqlConnection,rowId:number,transactionId:number,
):Promise<void> {
  if(!Number.isSafeInteger(rowId)||rowId<1||!Number.isSafeInteger(transactionId)||transactionId<1){
    throw new Error("Identificador de conciliação inválido.");
  }
  const row=await db.getFirstAsync<BankImportItem>(
    "SELECT * FROM bank_import_rows WHERE id=? AND source=? AND status='pending';",
    [rowId,NUBANK_ACCOUNT_SOURCE],
  );
  if(!row)throw new Error("Movimentação não está mais pendente.");
  const original=await db.getFirstAsync<{
    id:number;dateISO:string;type:string;amountCents:number;category:string|null;
  }>(
    "SELECT id,dateISO,type,amountCents,category FROM transactions WHERE id=? AND deletedAt IS NULL;",
    [transactionId],
  );
  if(!original || original.dateISO!==row.dateISO || original.type!==row.type ||
      original.amountCents!==row.amountCents){
    throw new Error("O lançamento selecionado não corresponde à mesma data, tipo e valor.");
  }
  const linked=await db.getFirstAsync<{total:number}>(
    "SELECT COUNT(*) AS total FROM bank_import_rows " +
    "WHERE transactionId=? AND status IN ('imported','merged');",
    [transactionId],
  );
  if((linked?.total??0)>0)throw new Error(
    "Esta transação já está vinculada a outro registro bancário. Revise individualmente.",
  );
  const changed=await db.runAsync(
    "UPDATE bank_import_rows SET status='merged', transactionId=?, category=?, " +
    "resolutionReason='linked_existing',updatedAt=? WHERE id=? AND source=? AND status='pending';",
    [transactionId,original.category,Date.now(),rowId,NUBANK_ACCOUNT_SOURCE],
  );
  if(changed.changes!==1)throw new Error("A conciliação mudou. Atualize a tela.");
}

/** Resolução explícita: nenhuma transação é criada para o dashboard. */
export async function skipBankRowCore(
  db:SqlConnection,rowId:number,reason:SkipReason,
):Promise<void> {
  const reasons:SkipReason[]=["duplicate_rejected","not_relevant","own_transfer",
    "already_recorded_card_payment","other_non_accounting"];
  if(!reasons.includes(reason))throw new Error("Motivo não reconhecido.");
  const status=reason==="own_transfer"||reason==="already_recorded_card_payment"||
    reason==="other_non_accounting"?"transfer":"ignored";
  const changed=await db.runAsync(
    "UPDATE bank_import_rows SET status=?,resolutionReason=?,category=NULL," +
    "transactionId=NULL,updatedAt=? WHERE id=? AND source=? AND status='pending';",
    [status,reason,Date.now(),rowId,NUBANK_ACCOUNT_SOURCE],
  );
  if(changed.changes!==1)throw new Error("Movimentação já revisada ou inexistente.");
}

/**
 * Categoria em massa e regra futura são escolhas distintas.
 * A regra é uma SUGESTÃO, nunca autorização de importação automática.
 */
export async function rememberCategoryGroupCore(
  db:SqlConnection,rowId:number,category:string,scope:GroupScope,
):Promise<{categorised:number;rules:number}> {
  const source=await db.getFirstAsync<{merchantKey:string;type:TransactionType}>(
    "SELECT merchantKey,type FROM bank_import_rows WHERE id=? AND source=? AND status='pending';",
    [rowId,NUBANK_ACCOUNT_SOURCE],
  );
  if(!source || !validExplicitCategory(source.type,category))throw new Error("Categoria ou lançamento inválido.");
  const selector=selectionPredicate(scope,source.merchantKey);
  const params=[NUBANK_ACCOUNT_SOURCE,source.type,...selector.values];
  const stores=await db.getAllAsync<{merchantKey:string}>(
    "SELECT DISTINCT merchantKey FROM bank_import_rows WHERE source=? " +
    "AND type=? AND status='pending' AND "+selector.clause+" ORDER BY merchantKey;",
    params,
  );
  if(!stores.length)throw new Error("Grupo não encontrado.");
  const categorised=await categorizePendingGroupCore(db,rowId,category,scope);
  const now=Date.now();
  for(const store of stores){
    await db.runAsync(
      "INSERT INTO bank_import_rules (source,merchantKey,type,action,category,updatedAt) " +
      "VALUES (?,?,?,'import',?,?) ON CONFLICT(source,merchantKey,type) " +
      "DO UPDATE SET action='import',category=excluded.category,updatedAt=excluded.updatedAt;",
      [NUBANK_ACCOUNT_SOURCE,store.merchantKey,source.type,category,now],
    );
  }
  return {categorised,rules:stores.length};
}
