import type { SQLiteDatabase } from "expo-sqlite";

export type TransactionType = "income" | "expense";

export type Transaction = {
  id: number;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  title: string;
  createdAt: number;
  notes: string | null;
};

export type NewTransactionInput = Omit<Transaction, "id" | "createdAt">;

// Lista todas as transações do banco de dados
export async function listTransactions(
  db: SQLiteDatabase
): Promise<Transaction[]> {
  return await db.getAllAsync<Transaction>(
    `SELECT *
    FROM transactions
    ORDER BY dateISO DESC, createdAt DESC;`
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Lista todas as transações de um mês específico
export async function listTransactionsByMonth(
  db: SQLiteDatabase,
  year: number,
  month1to12: number
): Promise<Transaction[]> {
  const start = `${year}-${pad2(month1to12)}-01`;

  const endYear = month1to12 === 12 ? year + 1 : year;
  const endMonth = month1to12 === 12 ? 1 : month1to12 + 1;
  const end = `${endYear}-${pad2(endMonth)}-01`;

  return await db.getAllAsync(
    `SELECT *
    FROM transactions
    WHERE dateISO >= ? AND dateISO < ?
    ORDER BY dateISO DESC, createdAt DESC;`,
    [start, end]
  );
}

// Adiciona uma nova transação ao banco de dados
export async function insertTransaction(
  db: SQLiteDatabase,
  input: Omit<Transaction, "id" | "createdAt">
) {
  const createdAt = Date.now();

  //runAsync com parametros para evitar SQL Injection
  await db.runAsync(
    `INSERT INTO transactions (dateISO, type, amountCents, title, createdAt)
         VALUES (?, ?, ?, ?, ?);`,
    [
      input.dateISO,
      input.type,
      input.amountCents,
      input.title,
      createdAt,
      input.notes ?? null,
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
    WHERE id = ?;`,
    [id]
  );
  return transaction || null;
}

// Deleta uma transação do banco de dados pelo ID
export async function deleteTransaction(db: SQLiteDatabase, id: number) {
  await db.runAsync(`DELETE FROM transactions WHERE id = ?;`, [id]);
}

// Atualiza uma transação existente no banco de dados pelo ID
export async function updateTransaction(
  db: SQLiteDatabase,
  id: number,
  input: Omit<Transaction, "id" | "createdAt">
) {
  await db.runAsync(
    `UPDATE transactions
      SET dateISO = ?, type = ?, amountCents = ?, title = ?, notes = ?
      WHERE id = ?;`,
    [
      input.dateISO,
      input.type,
      input.amountCents,
      input.title,
      input.notes ?? null,
      id,
    ]
  );
}
