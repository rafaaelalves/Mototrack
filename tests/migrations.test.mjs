import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase, DATABASE_VERSION } from "../src/db/migrations.ts";

/**
 * Adaptador de testes com SQLite real do Node. Simula somente a interface
 * Expo usada por migrations.ts; não substitui um teste no Android.
 */
function makeDatabase(schema = "") {
  const sqlite = new DatabaseSync(":memory:");
  if (schema) sqlite.exec(schema);

  const db = {
    execAsync: async (sql) => { sqlite.exec(sql); },
    getFirstAsync: async (sql) => sqlite.prepare(sql).get() ?? null,
    getAllAsync: async (sql) => sqlite.prepare(sql).all(),
    withTransactionAsync: async (fn) => {
      sqlite.exec("BEGIN TRANSACTION;");
      try {
        await fn();
        sqlite.exec("COMMIT;");
      } catch (error) {
        sqlite.exec("ROLLBACK;");
        throw error;
      }
    },
  };
  return { db, sqlite };
}

const legacy = `
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY NOT NULL,
    dateISO TEXT NOT NULL,
    type TEXT NOT NULL,
    amountCents INTEGER NOT NULL,
    title TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
  INSERT INTO transactions
    (id, dateISO, type, amountCents, title, createdAt)
    VALUES (42, '2026-11-15', 'income', 11900, 'Teste fictício', 123456);
`;

test("banco novo cria esquema completo, índice e versão 1", async (t) => {
  const { db, sqlite } = makeDatabase();
  t.after(() => sqlite.close());
  await migrateDatabase(db);
  assert.equal(sqlite.prepare("PRAGMA user_version;").get().user_version, DATABASE_VERSION);
  const cols = sqlite.prepare("PRAGMA table_info(transactions);").all().map((r) => r.name);
  for (const c of ["id","dateISO","type","amountCents","title","createdAt",
    "updatedAt","deletedAt","notes","category","distanceMeters"]) {
    assert.ok(cols.includes(c), `Coluna ausente: ${c}`);
  }
  const index = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_transactions_active_date';",
  ).get();
  assert.equal(index.name, "idx_transactions_active_date");
});

test("schema legado recebe colunas sem alterar ID e valor monetário", async (t) => {
  const { db, sqlite } = makeDatabase(legacy);
  t.after(() => sqlite.close());
  await migrateDatabase(db);
  const item = sqlite.prepare("SELECT * FROM transactions WHERE id=42;").get();
  assert.equal(item.amountCents, 11900);
  assert.equal(item.title, "Teste fictício");
  assert.equal(item.updatedAt, 123456);
  assert.equal(item.deletedAt, null);
  assert.equal(item.notes, null);
  assert.equal(item.distanceMeters, null);
  assert.equal(sqlite.prepare("PRAGMA user_version;").get().user_version, 2);
});

test("migração é idempotente e mantém exclusões lógicas", async (t) => {
  const { db, sqlite } = makeDatabase(legacy);
  t.after(() => sqlite.close());
  await migrateDatabase(db);
  sqlite.exec("UPDATE transactions SET deletedAt=9999 WHERE id=42;");
  const before = sqlite.prepare("SELECT * FROM transactions WHERE id=42;").get();
  await migrateDatabase(db);
  const after = sqlite.prepare("SELECT * FROM transactions WHERE id=42;").get();
  assert.deepEqual(after, before);
});

test("versão futura não é sobrescrita nem migrada", async (t) => {
  const { db, sqlite } = makeDatabase("PRAGMA user_version=9;");
  t.after(() => sqlite.close());
  await assert.rejects(() => migrateDatabase(db), /superior à suportada/);
  assert.equal(sqlite.prepare("PRAGMA user_version;").get().user_version, 9);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) as n FROM sqlite_master WHERE name='transactions';",
  ).get().n, 0);
});

test("schema legado incompatível não é modificado", async (t) => {
  const { db, sqlite } = makeDatabase(
    "CREATE TABLE transactions (id INTEGER PRIMARY KEY, dateISO TEXT);",
  );
  t.after(() => sqlite.close());
  await assert.rejects(() => migrateDatabase(db), /coluna obrigatória/);
  assert.equal(sqlite.prepare("PRAGMA user_version;").get().user_version, 0);
  const cols = sqlite.prepare("PRAGMA table_info(transactions);").all().map((c) => c.name);
  assert.deepEqual(cols, ["id", "dateISO"]);
});

test("erro ao criar índice reverte ALTER TABLE e versão", async (t) => {
  const { db, sqlite } = makeDatabase(
    legacy + "CREATE TABLE idx_transactions_active_date (id INTEGER);",
  );
  t.after(() => sqlite.close());
  await assert.rejects(() => migrateDatabase(db));
  assert.equal(sqlite.prepare("PRAGMA user_version;").get().user_version, 0);
  const cols = sqlite.prepare("PRAGMA table_info(transactions);").all().map((c) => c.name);
  assert.deepEqual(cols, ["id","dateISO","type","amountCents","title","createdAt"]);
  assert.equal(sqlite.prepare("SELECT amountCents FROM transactions;").get().amountCents, 11900);
});

test("banco v1 evolui para importação v2 sem alterar transações", async (t) => {
  const { db, sqlite } = makeDatabase(legacy);
  t.after(() => sqlite.close());
  await migrateDatabase(db);
  const before = sqlite.prepare("SELECT id, amountCents FROM transactions;").get();
  sqlite.exec("PRAGMA user_version=1;");
  await migrateDatabase(db);
  const after = sqlite.prepare("SELECT id, amountCents FROM transactions;").get();
  assert.deepEqual(after, before);
  assert.equal(sqlite.prepare("PRAGMA user_version;").get().user_version, 2);
  for (const name of ["bank_import_rows", "bank_import_rules"]) {
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name=?;").get(name));
  }
});
