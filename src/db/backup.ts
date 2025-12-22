import type { SQLiteDatabase } from "expo-sqlite";
import type { Transaction } from "./transactions";

export type BackupFile = {
  version: 1;
  exportedAt: number;
  transactions: Transaction[];
};

// Lê as transações e monta um JSON de backup
export async function buildBackup(db: SQLiteDatabase): Promise<BackupFile> {
  const rows = await db.getAllAsync<Transaction>(
    `SELECT *
     FROM transactions
     ORDER BY dateISO DESC, createdAt DESC;`
  );

  return {
    version: 1,
    exportedAt: Date.now(),
    transactions: rows,
  };
}

export async function applyBackup(
  db: SQLiteDatabase,
  data: BackupFile
): Promise<void> {
  if (data.version !== 1) {
    throw new Error("Versão de backup não suportada.");
  }

  const txs = data.transactions ?? [];

  await db.withTransactionAsync(async () => {
    // limpa tudo
    await db.runAsync(`DELETE FROM transactions;`);

    const sql = `
      INSERT INTO transactions (
        id,
        dateISO,
        type,
        amountCents,
        title,
        createdAt,
        updatedAt,
        deletedAt,
        notes,
        category,
        distanceMeters
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    for (const t of txs) {
      await db.runAsync(sql, [
        t.id,
        t.dateISO,
        t.type,
        t.amountCents,
        t.title,
        t.createdAt,
        t.updatedAt ?? t.createdAt,
        t.deletedAt ?? null,
        t.notes ?? null,
        t.category ?? null,
        t.distanceMeters ?? null,
      ]);
    }
  });
}
