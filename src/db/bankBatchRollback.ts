import type { SQLiteDatabase } from "expo-sqlite";
import type { TransactionType } from "../domain/transaction";

type SqlConnection = Pick<SQLiteDatabase, "getFirstAsync" | "getAllAsync" | "runAsync">;
const SOURCE = "nubank-account";

type ImportedRow = {
  id: number; sourceId: string; dateISO: string; type: TransactionType;
  amountCents: number; description: string; category: string | null;
  transactionId: number | null;
};
type LinkedTransaction = {
  id: number; dateISO: string; type: TransactionType; amountCents: number;
  title: string; notes: string | null; category: string | null;
  createdAt: number; updatedAt: number; deletedAt: number | null;
  distanceMeters: number | null;
};
export type SafeReversal = {
  rowId: number;
  transactionId: number;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  description: string;
};
export type BlockedReversal = {
  rowId: number;
  description: string;
  reason: string;
};
export type BatchReversalPreview = {
  batchCreatedAt: number;
  eligible: SafeReversal[];
  blocked: BlockedReversal[];
  alreadyInactive: number;
  incomeCents: number;
  expenseCents: number;
};

/** Só desfaz transações CRIADAS pelo importador, nunca transações manuais. */
export async function previewBankBatchReversalCore(
  db: SqlConnection,
  batchCreatedAt: number,
): Promise<BatchReversalPreview> {
  if (!Number.isSafeInteger(batchCreatedAt) || batchCreatedAt < 1) {
    throw new Error("Lote inválido para reversão.");
  }
  const batch = await db.getFirstAsync<{ createdAt: number }>(
    "SELECT createdAt FROM bank_import_batches WHERE source=? AND createdAt=?;",
    [SOURCE, batchCreatedAt],
  );
  if (!batch) throw new Error("Lote não encontrado.");

  const imported = await db.getAllAsync<ImportedRow>(
    "SELECT id, sourceId, dateISO, type, amountCents, description, category, transactionId " +
    "FROM bank_import_rows WHERE source=? AND createdAt=? AND status='imported' ORDER BY id;",
    [SOURCE, batchCreatedAt],
  );
  const eligible: SafeReversal[] = [];
  const blocked: BlockedReversal[] = [];
  let alreadyInactive = 0;
  let incomeCents = 0;
  let expenseCents = 0;

  for (const row of imported) {
    if (!row.transactionId) {
      blocked.push({ rowId: row.id, description: row.description, reason: "Sem vínculo com lançamento." });
      continue;
    }
    const tx = await db.getFirstAsync<LinkedTransaction>(
      "SELECT * FROM transactions WHERE id=?;",
      [row.transactionId],
    );
    if (!tx) {
      blocked.push({ rowId: row.id, description: row.description, reason: "Lançamento vinculado ausente." });
      continue;
    }
    if (tx.deletedAt !== null) {
      alreadyInactive++;
      continue;
    }
    const links = await db.getFirstAsync<{ total: number }>(
      "SELECT COUNT(*) AS total FROM bank_import_rows WHERE transactionId=? AND status='imported';",
      [tx.id],
    );
    // Confrontar TODOS os atributos que o importador escreveu, além do
    // identificador externo em notes e do marcador de edição.
    const matches =
      links?.total === 1 &&
      tx.notes === "mototrack:nubank-account:" + row.sourceId &&
      tx.dateISO === row.dateISO &&
      tx.type === row.type &&
      tx.amountCents === row.amountCents &&
      tx.title === row.description &&
      tx.category === row.category &&
      tx.distanceMeters === null &&
      tx.updatedAt === tx.createdAt;

    if (!matches) {
      blocked.push({
        rowId: row.id,
        description: row.description,
        reason: "Dados alterados, vínculo inconclusivo ou transação editada.",
      });
      continue;
    }
    eligible.push({
      rowId: row.id,
      transactionId: tx.id,
      dateISO: row.dateISO,
      type: row.type,
      amountCents: row.amountCents,
      description: row.description,
    });
    if (row.type === "income") incomeCents += row.amountCents;
    else expenseCents += row.amountCents;
  }
  return { batchCreatedAt, eligible, blocked, alreadyInactive, incomeCents, expenseCents };
}

/**
 * Reavalia tudo DENTRO da transação aberta pelo adaptador Expo.
 * expected é a prévia aprovada pelo usuário; divergências abortam o lote.
 * A reversão é exclusão lógica, com evento auditável. O vínculo bancário
 * original é preservado para não reimportar automaticamente o mesmo UUID.
 */
export async function reverseBankBatchCore(
  db: SqlConnection,
  expected: BatchReversalPreview,
): Promise<{ reversed: number; blocked: number; incomeCents: number; expenseCents: number }> {
  const fresh = await previewBankBatchReversalCore(db, expected.batchCreatedAt);
  const actualIds = fresh.eligible.map((entry) => entry.transactionId);
  const expectedIds = expected.eligible.map((entry) => entry.transactionId);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds) ||
      fresh.incomeCents !== expected.incomeCents ||
      fresh.expenseCents !== expected.expenseCents) {
    throw new Error("Os lançamentos mudaram depois da prévia. Consulte novamente antes de reverter.");
  }
  if (!fresh.eligible.length) throw new Error("Não há lançamentos elegíveis para reversão.");
  const now = Date.now();
  for (const entry of fresh.eligible) {
    const changed = await db.runAsync(
      "UPDATE transactions SET deletedAt=?, updatedAt=? " +
      "WHERE id=? AND deletedAt IS NULL AND updatedAt=createdAt " +
      "AND notes=? AND dateISO=? AND type=? AND amountCents=? AND title=?;",
      [
        now, now, entry.transactionId,
        "mototrack:nubank-account:" +
          (await db.getFirstAsync<{ sourceId: string }>(
            "SELECT sourceId FROM bank_import_rows WHERE id=? AND transactionId=? AND status='imported';",
            [entry.rowId, entry.transactionId],
          ))?.sourceId,
        entry.dateISO, entry.type, entry.amountCents, entry.description,
      ],
    );
    if (changed.changes !== 1) {
      throw new Error("Falha na verificação de origem. Nenhum lançamento foi revertido.");
    }
  }
  const modified = await db.runAsync(
    "UPDATE bank_import_batches SET lastActivityAt=? WHERE createdAt=? AND source=?;",
    [now, expected.batchCreatedAt, SOURCE],
  );
  if (modified.changes !== 1) throw new Error("Lote alterado durante a reversão.");
  await db.runAsync(
    "INSERT INTO bank_import_batch_events " +
    "(source, batchCreatedAt, action, affectedCount, occurredAt) " +
    "VALUES (?, ?, 'approved_reversed', ?, ?);",
    [SOURCE, expected.batchCreatedAt, fresh.eligible.length, now],
  );
  return {
    reversed: fresh.eligible.length,
    blocked: fresh.blocked.length,
    incomeCents: fresh.incomeCents,
    expenseCents: fresh.expenseCents,
  };
}
