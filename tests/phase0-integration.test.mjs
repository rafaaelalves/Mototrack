import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { parseBackupFile } from "../src/domain/backupValidation.ts";
import { replaceTransactions } from "../src/db/restoreCore.ts";

/**
 * Integra migração, validação e escrita SQL com SQLite real no Node.
 * O contrato Expo com transação exclusiva continua exigindo teste no Android.
 */
function makeDatabase(t, initialSql = "") {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  if (initialSql) sqlite.exec(initialSql);

  const connection = {
    execAsync: async (sql) => { sqlite.exec(sql); },
    getFirstAsync: async (sql) => sqlite.prepare(sql).get() ?? null,
    getAllAsync: async (sql) => sqlite.prepare(sql).all(),
    runAsync: async (sql, values = []) => sqlite.prepare(sql).run(...values),
    withTransactionAsync: async (fn) => atomic(sqlite, fn),
  };
  return { sqlite, connection };
}

async function atomic(sqlite, operation) {
  sqlite.exec("BEGIN TRANSACTION;");
  try {
    const result = await operation();
    sqlite.exec("COMMIT;");
    return result;
  } catch (error) {
    sqlite.exec("ROLLBACK;");
    throw error;
  }
}

const row = (id, amountCents, overrides = {}) => ({
  id,
  dateISO: "2026-11-15",
  type: "income",
  amountCents,
  title: "Lançamento fictício",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  deletedAt: null,
  notes: null,
  category: "delivery",
  distanceMeters: 42_000,
  ...overrides,
});

const backup = (transactions) =>
  parseBackupFile({ version: 1, exportedAt: 1_700_000_000_000, transactions });

async function restore(connection, sqlite, data) {
  await atomic(sqlite, () => replaceTransactions(connection, data));
}

test("banco novo: restauração preserva centavos, distância, categoria e exclusão lógica", async (t) => {
  const { sqlite, connection } = makeDatabase(t);
  await migrateDatabase(connection);
  await restore(connection, sqlite, backup([
    row(1, 11900),
    row(2, 3500, { type: "expense", category: "fuel", deletedAt: 1_700_000_000_500 }),
  ]));

  const rows = sqlite.prepare("SELECT * FROM transactions ORDER BY id;").all();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.id, r.amountCents, r.category, r.distanceMeters, r.deletedAt]),
    [
      [1, 11900, "delivery", 42000, null],
      [2, 3500, "fuel", 42000, 1700000000500],
    ],
  );
  assert.equal(sqlite.prepare("PRAGMA user_version;").get().user_version, 4);
});

test("banco legado: migração e restauração de backup v1 antigo funcionam juntas", async (t) => {
  const legacy = `
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY NOT NULL,
      dateISO TEXT NOT NULL,
      type TEXT NOT NULL,
      amountCents INTEGER NOT NULL,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    INSERT INTO transactions (id, dateISO, type, amountCents, title, createdAt)
      VALUES (9, '2026-11-14', 'income', 1000, 'Antes da migração', 1234);
  `;
  const { sqlite, connection } = makeDatabase(t, legacy);
  await migrateDatabase(connection);
  const original = sqlite.prepare("SELECT * FROM transactions WHERE id=9;").get();
  assert.equal(original.updatedAt, 1234);

  const oldBackup = backup([{
    id: 3, dateISO: "2026-11-15", type: "income", amountCents: 5000,
    title: "Backup legado", createdAt: 5555,
  }]);
  await restore(connection, sqlite, oldBackup);
  const after = sqlite.prepare("SELECT * FROM transactions;").all();
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 3);
  assert.equal(after[0].updatedAt, 5555);
  assert.equal(after[0].category, null);
  assert.equal(after[0].distanceMeters, null);
});

test("uma falha de INSERT reverte o DELETE e mantém dados anteriores", async (t) => {
  const { sqlite, connection } = makeDatabase(t);
  await migrateDatabase(connection);
  await restore(connection, sqlite, backup([row(1, 7000)]));

  sqlite.exec(`
    CREATE TRIGGER prevent_large_backup
    BEFORE INSERT ON transactions
    WHEN NEW.amountCents > 20000
    BEGIN
      SELECT RAISE(ABORT, 'limite de teste');
    END;
  `);

  await assert.rejects(
    () => restore(connection, sqlite, backup([row(2, 12000), row(3, 25000)])),
    /limite de teste/,
  );
  const rows = sqlite.prepare("SELECT id, amountCents FROM transactions;").all();
  assert.deepEqual(rows.map((r) => [r.id, r.amountCents]), [[1, 7000]]);
});

test("arquivo vazio não pode substituir um banco com registros", async (t) => {
  const { sqlite, connection } = makeDatabase(t);
  await migrateDatabase(connection);
  await restore(connection, sqlite, backup([row(1, 9000)]));
  await assert.rejects(
    () => restore(connection, sqlite, backup([])),
    /backup está vazio/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM transactions;").get().total, 1);
});

test("backup inválido é rejeitado antes de escrever no SQLite", async (t) => {
  const { sqlite, connection } = makeDatabase(t);
  await migrateDatabase(connection);
  await restore(connection, sqlite, backup([row(1, 9000)]));

  assert.throws(() => backup([row(2, -1)]), /valor/);
  assert.throws(() => backup([row(2, 300), row(2, 400)]), /repetidos/);
  assert.equal(sqlite.prepare("SELECT amountCents FROM transactions WHERE id=1;").get().amountCents, 9000);
});
