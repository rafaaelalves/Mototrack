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

export async function replaceTransactions(
  connection: RestoreConnection,
  data: BackupFile,
): Promise<void> {
  const existing = await connection.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM transactions;",
  );

  // Mesmo um backup vazio corretamente formatado não pode apagar dados.
  if (data.transactions.length === 0 && (existing?.count ?? 0) > 0) {
    throw new Error(
      "O backup não contém lançamentos e não pode substituir um banco com dados.",
    );
  }

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
}
