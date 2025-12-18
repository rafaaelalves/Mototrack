import type { SQLiteDatabase } from "expo-sqlite";

export type TransactionType = "income" | "expense";

export type Transaction = {
  id: number;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  notes: string | null;
  category: string | null;
  distanceMeters: number | null;
};

export type NewTransactionInput = Omit<
  Transaction,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Lista todas as transações do banco de dados não apagadas
export async function listTransactions(
  db: SQLiteDatabase
): Promise<Transaction[]> {
  return await db.getAllAsync<Transaction>(
    `SELECT *
    FROM transactions
    WHERE deletedAt IS NULL
    ORDER BY dateISO DESC, createdAt DESC;`
  );
}

// Lista todas as transações de um mês específico não apagadas
export async function listTransactionsByMonth(
  db: SQLiteDatabase,
  year: number,
  month1to12: number
): Promise<Transaction[]> {
  const start = `${year}-${pad2(month1to12)}-01`;

  const endYear = month1to12 === 12 ? year + 1 : year;
  const endMonth = month1to12 === 12 ? 1 : month1to12 + 1;
  const end = `${endYear}-${pad2(endMonth)}-01`;

  return await db.getAllAsync<Transaction>(
    `SELECT *
    FROM transactions
    WHERE dateISO >= ?
    AND dateISO < ?
    AND deletedAt IS NULL
    ORDER BY dateISO DESC, createdAt DESC;`,
    [start, end]
  );
}

// Adiciona uma nova transação ao banco de dados
export async function insertTransaction(
  db: SQLiteDatabase,
  input: NewTransactionInput
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
    ]
  );
}

export async function getTransactionById(
  db: SQLiteDatabase,
  id: number
): Promise<Transaction | null> {
  const transaction = await db.getFirstAsync<Transaction>(
    `SELECT *
    FROM transactions
    WHERE id = ?
    AND deletedAT IS NULL`,
    [id]
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
    [now, now, id]
  );
}

// Atualiza uma transação existente no banco de dados pelo ID
export async function updateTransaction(
  db: SQLiteDatabase,
  id: number,
  input: NewTransactionInput
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
    ]
  );
}
