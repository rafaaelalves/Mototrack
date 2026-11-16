import { Platform } from "react-native";
import { parseBackupFile, type BackupFile } from "@/src/domain/backupValidation";
import type { Transaction } from "@/src/domain/transaction";
import type { SQLiteDatabase } from "expo-sqlite";

export type { BackupFile } from "@/src/domain/backupValidation";

type RestoreConnection = Pick<SQLiteDatabase, "getFirstAsync" | "runAsync">;

const INSERT_TRANSACTION = `
  INSERT INTO transactions (
    id, dateISO, type, amountCents, title, createdAt, updatedAt,
    deletedAt, notes, category, distanceMeters
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

// Inclui lançamentos excluídos logicamente para preservar o banco completo.
export async function buildBackup(db: SQLiteDatabase): Promise<BackupFile> {
  const rows = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions ORDER BY dateISO DESC, createdAt DESC;`,
  );

  return parseBackupFile({
    version: 1,
    exportedAt: Date.now(),
    transactions: rows,
  });
}

async function replaceTransactions(
  connection: RestoreConnection,
  data: BackupFile,
): Promise<void> {
  const existing = await connection.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM transactions;",
  );

  // Um arquivo vazio não pode apagar silenciosamente um banco com dados.
  if (data.transactions.length === 0 && (existing?.count ?? 0) > 0) {
    throw new Error(
      "O backup não contém lançamentos e não pode substituir um banco com dados.",
    );
  }

  // Todos os campos e IDs foram validados antes de entrar na transação.
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

/**
 * Restauração atômica: se algum INSERT falhar, o DELETE é revertido.
 * No Android/iOS, transação exclusiva impede que consultas externas
 * entrem acidentalmente na transação da restauração.
 *
 * O backup de recuperação pré-restauração é criado pela camada de serviço
 * ANTES de invocar esta função. Nunca usar diretamente pela UI.
 */
export async function applyBackup(
  db: SQLiteDatabase,
  input: unknown,
): Promise<void> {
  const data = parseBackupFile(input);

  if (Platform.OS === "web") {
    // Expo SQLite não oferece withExclusiveTransactionAsync no navegador.
    await db.withTransactionAsync(async () => {
      await replaceTransactions(db, data);
    });
    return;
  }

  await db.withExclusiveTransactionAsync(async (tx) => {
    await replaceTransactions(tx, data);
  });
}
