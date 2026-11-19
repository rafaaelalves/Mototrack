import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Primeira versão explícita do schema do Mototrack.
 *
 * A versão 0 pode representar tanto uma instalação nova quanto um banco
 * antigo criado antes da adoção do PRAGMA user_version. Nunca apagamos
 * dados para "corrigir" uma migração.
 */
export const DATABASE_VERSION = 3;

const REQUIRED_LEGACY_COLUMNS = [
  "id",
  "dateISO",
  "type",
  "amountCents",
  "title",
  "createdAt",
] as const;

const OPTIONAL_LEGACY_COLUMNS = {
  updatedAt: "INTEGER NOT NULL DEFAULT 0",
  deletedAt: "INTEGER",
  notes: "TEXT",
  category: "TEXT",
  distanceMeters: "INTEGER",
} as const;

type SqliteColumnInfo = { name: string };

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  // Deve ser configurado fora da transação.
  await db.execAsync("PRAGMA journal_mode = WAL;");

  const version = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;",
  );

  if (!version || !Number.isInteger(version.user_version)) {
    throw new Error("Não foi possível identificar a versão do banco.");
  }

  if (version.user_version > DATABASE_VERSION) {
    throw new Error(
      `Banco na versão ${version.user_version}, superior à suportada (${DATABASE_VERSION}). Atualize o aplicativo.`,
    );
  }

  if (version.user_version === DATABASE_VERSION) return;

  // Chamado pelo SQLiteProvider.onInit, antes da renderização dos consumidores.
  // Versão do schema e alterações devem ser confirmadas no mesmo commit SQL.
  await db.withTransactionAsync(async () => {
    if (version.user_version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY NOT NULL,
        dateISO TEXT NOT NULL,
        type TEXT NOT NULL,
        amountCents INTEGER NOT NULL,
        title TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        deletedAt INTEGER,
        notes TEXT,
        category TEXT,
        distanceMeters INTEGER
      );
    `);

    const columnInfo = await db.getAllAsync<SqliteColumnInfo>(
      "PRAGMA table_info(transactions);",
    );
    const existingColumns = new Set(columnInfo.map((column) => column.name));

    // Não tentar adaptar silenciosamente um banco incompatível.
    for (const required of REQUIRED_LEGACY_COLUMNS) {
      if (!existingColumns.has(required)) {
        throw new Error(
          `A tabela de transações existente não possui a coluna obrigatória: ${required}.`,
        );
      }
    }

    const needsUpdatedAt = !existingColumns.has("updatedAt");

    for (const [column, definition] of Object.entries(
      OPTIONAL_LEGACY_COLUMNS,
    )) {
      if (!existingColumns.has(column)) {
        // Nomes e definições vêm de constantes internas, não de dados externos.
        await db.execAsync(
          `ALTER TABLE transactions ADD COLUMN ${column} ${definition};`,
        );
      }
    }

    if (needsUpdatedAt) {
      await db.execAsync(
        "UPDATE transactions SET updatedAt = createdAt WHERE updatedAt = 0;",
      );
    }

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_transactions_active_date
        ON transactions(deletedAt, dateISO);
      PRAGMA user_version = 1;
    `);
    }

    if (version.user_version < 2) {
      // Extratos bancários nunca entram diretamente no dashboard.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS bank_import_rows (
          id INTEGER PRIMARY KEY NOT NULL,
          source TEXT NOT NULL,
          sourceId TEXT NOT NULL,
          dateISO TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('income','expense')),
          amountCents INTEGER NOT NULL CHECK (amountCents > 0),
          description TEXT NOT NULL,
          merchantKey TEXT NOT NULL,
          suggestedCategory TEXT,
          suggestedAction TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','imported','ignored','transfer')),
          category TEXT,
          transactionId INTEGER,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          UNIQUE(source, sourceId)
        );
        CREATE INDEX IF NOT EXISTS idx_bank_import_pending
          ON bank_import_rows(source, status, dateISO);
        CREATE INDEX IF NOT EXISTS idx_bank_import_merchant
          ON bank_import_rows(source, merchantKey, type, status);
        CREATE TABLE IF NOT EXISTS bank_import_rules (
          id INTEGER PRIMARY KEY NOT NULL,
          source TEXT NOT NULL,
          merchantKey TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('income','expense')),
          action TEXT NOT NULL CHECK (action IN ('import','ignore','transfer')),
          category TEXT,
          updatedAt INTEGER NOT NULL,
          UNIQUE(source, merchantKey, type)
        );
        PRAGMA user_version = 2;
      `);
    }

    if (version.user_version < 3) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS bank_import_batches (
          createdAt INTEGER PRIMARY KEY NOT NULL,
          source TEXT NOT NULL,
          firstDate TEXT NOT NULL,
          lastDate TEXT NOT NULL,
          originalCount INTEGER NOT NULL CHECK (originalCount >= 0),
          cancelledCount INTEGER NOT NULL DEFAULT 0 CHECK (cancelledCount >= 0),
          lastActivityAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bank_import_batch_events (
          id INTEGER PRIMARY KEY NOT NULL,
          source TEXT NOT NULL,
          batchCreatedAt INTEGER NOT NULL,
          action TEXT NOT NULL CHECK (
            action IN ('pending_cancelled', 'approved_reversed')
          ),
          affectedCount INTEGER NOT NULL CHECK (affectedCount > 0),
          occurredAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bank_import_events_batch
          ON bank_import_batch_events(batchCreatedAt, occurredAt);
        INSERT OR IGNORE INTO bank_import_batches (
          createdAt, source, firstDate, lastDate, originalCount,
          cancelledCount, lastActivityAt
        )
        SELECT createdAt, MIN(source), MIN(dateISO), MAX(dateISO),
               COUNT(*), 0, MAX(updatedAt)
        FROM bank_import_rows GROUP BY createdAt;
        PRAGMA user_version = 3;
      `);
    }
  });
}
