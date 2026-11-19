import type { SQLiteDatabase } from "expo-sqlite";
import type { BackupFile } from "../domain/backupValidation";

/**
 * Núcleo SQL da restauração, independente da interface.
 * A transação é responsabilidade do chamador (applyBackup).
 * Separar este núcleo permite testar a substituição real com SQLite no Node.
 */
export type RestoreConnection = Pick<SQLiteDatabase, "getFirstAsync" | "runAsync">;

const INSERT_TRANSACTION = `
  INSERT INTO transactions (
    id, dateISO, type, amountCents, title, createdAt, updatedAt,
    deletedAt, notes, category, distanceMeters
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;


const INSERT_BANK_ROW =
  "INSERT INTO bank_import_rows (" +
  "id, source, sourceId, dateISO, type, amountCents, description, merchantKey, " +
  "suggestedCategory, suggestedAction, status, category, transactionId, createdAt, updatedAt) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";

const INSERT_BANK_RULE =
  "INSERT INTO bank_import_rules (" +
  "id, source, merchantKey, type, action, category, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);";


const INSERT_BANK_BATCH =
  "INSERT INTO bank_import_batches " +
  "(createdAt, source, firstDate, lastDate, originalCount, cancelledCount, lastActivityAt) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?);";
const INSERT_BANK_EVENT =
  "INSERT INTO bank_import_batch_events " +
  "(id, source, batchCreatedAt, action, affectedCount, occurredAt) " +
  "VALUES (?, ?, ?, ?, ?, ?);";

export async function replaceTransactions(
  connection: RestoreConnection,
  data: BackupFile,
): Promise<void> {
  const existing = await connection.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM transactions;",
  );

  const pending = await connection.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM bank_import_rows;",
  );
  const history = await connection.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM bank_import_batches;",
  );
  if (data.transactions.length === 0 && data.bankImportRows.length === 0 &&
      data.bankImportBatches.length === 0 &&
      ((existing?.count ?? 0) > 0 || (pending?.count ?? 0) > 0 || (history?.count ?? 0) > 0)) {
    throw new Error(
      "O backup está vazio e não pode substituir um banco com dados.",
    );
  }

  // Todos os objetos foram validados ANTES desta transação.
  // As tabelas de estágio referenciam os IDs das transações.
  await connection.runAsync("DELETE FROM bank_import_batch_events;");
  await connection.runAsync("DELETE FROM bank_import_batches;");
  await connection.runAsync("DELETE FROM bank_import_rows;");
  await connection.runAsync("DELETE FROM bank_import_rules;");
  await connection.runAsync("DELETE FROM transactions;");
  for (const t of data.transactions) {
    await connection.runAsync(INSERT_TRANSACTION, [
      t.id,
      t.dateISO,
      t.type,
      t.amountCents,
      t.title,
      t.createdAt,
      t.updatedAt,
      t.deletedAt,
      t.notes,
      t.category,
      t.distanceMeters,
    ]);
  }
  for (const row of data.bankImportRows) {
    await connection.runAsync(INSERT_BANK_ROW, [
      row.id, row.source, row.sourceId, row.dateISO, row.type,
      row.amountCents, row.description, row.merchantKey,
      row.suggestedCategory, row.suggestedAction, row.status,
      row.category, row.transactionId, row.createdAt, row.updatedAt,
    ]);
  }
  for (const rule of data.bankImportRules) {
    await connection.runAsync(INSERT_BANK_RULE, [
      rule.id, rule.source, rule.merchantKey, rule.type, rule.action,
      rule.category, rule.updatedAt,
    ]);
  }
  if (data.version === 3) {
    for (const batch of data.bankImportBatches) {
      await connection.runAsync(INSERT_BANK_BATCH, [
        batch.createdAt, batch.source, batch.firstDate, batch.lastDate,
        batch.originalCount, batch.cancelledCount, batch.lastActivityAt,
      ]);
    }
    for (const event of data.bankImportEvents) {
      await connection.runAsync(INSERT_BANK_EVENT, [
        event.id, event.source, event.batchCreatedAt, event.action,
        event.affectedCount, event.occurredAt,
      ]);
    }
  } else {
    // V2 possui a fila, mas ainda não tem lotes nem histórico separado.
    await connection.runAsync(
      "INSERT INTO bank_import_batches (" +
      "createdAt, source, firstDate, lastDate, originalCount, cancelledCount, lastActivityAt) " +
      "SELECT createdAt, MIN(source), MIN(dateISO), MAX(dateISO), COUNT(*), 0, MAX(updatedAt) " +
      "FROM bank_import_rows GROUP BY createdAt;"
    );
  }
}
