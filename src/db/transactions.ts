import type { SQLiteDatabase } from "expo-sqlite";
import { Transaction } from "../domain/transaction";

export type NewTransactionInput = Omit<
  Transaction,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

// Lista todas as transações do banco de dados não apagadas
export async function listTransactions(
  db: SQLiteDatabase,
): Promise<Transaction[]> {
  return await db.getAllAsync<Transaction>(
    `SELECT *
    FROM transactions
    WHERE deletedAt IS NULL
    ORDER BY dateISO DESC, createdAt DESC;`,
  );
}

// Lista todas as transações de um período
export async function listTransactionsByDateRange(
  db: SQLiteDatabase,
  startISO: string,
  endISO: string,
): Promise<Transaction[]> {
  const query = `SELECT *
    FROM transactions
    WHERE deletedAt IS NULL
    AND dateISO >= ?
    AND dateISO <= ?
    ORDER BY dateISO DESC, createdAt DESC;`;
  return await db.getAllAsync<Transaction>(query, [startISO, endISO]);
}

// Adiciona uma nova transação ao banco de dados
export async function insertTransaction(
  db: SQLiteDatabase,
  input: NewTransactionInput,
) {
  const createdAt = Date.now();
  const updatedAt = createdAt;
  const deletedAt: number | null = null;

  // runAsync com parametros para evitar SQL Injection
  await db.runAsync(
    `INSERT INTO transactions (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.dateISO,
      input.type,
      input.amountCents,
      input.title,
      createdAt,
      updatedAt,
      deletedAt,
      input.notes ?? null,
      input.category,
      input.distanceMeters,
    ],
  );
}

export async function getTransactionById(
  db: SQLiteDatabase,
  id: number,
): Promise<Transaction | null> {
  const transaction = await db.getFirstAsync<Transaction>(
    `SELECT *
    FROM transactions
    WHERE id = ?
    AND deletedAt IS NULL`,
    [id],
  );
  return transaction || null;
}

// Soft delete: marca deletedAt em vez de remover de fato
export async function deleteTransaction(db: SQLiteDatabase, id: number) {
  const now = Date.now();
  await db.runAsync(
    `UPDATE transactions
    SET deletedAt = ?, updatedAt = ?
    WHERE id = ?;`,
    [now, now, id],
  );
}

// Atualiza uma transação existente no banco de dados pelo ID
export async function updateTransaction(
  db: SQLiteDatabase,
  id: number,
  input: NewTransactionInput,
) {
  const updatedAt = Date.now();
  await db.runAsync(
    `UPDATE transactions
      SET dateISO = ?,
      type = ?,
      amountCents = ?,
      title = ?,
      notes = ?,
      category = ?,
      distanceMeters = ?,
      updatedAt = ?
      WHERE id = ?;`,
    [
      input.dateISO,
      input.type,
      input.amountCents,
      input.title,
      input.notes ?? null,
      input.category,
      input.distanceMeters,
      updatedAt,
      id,
    ],
  );
}
