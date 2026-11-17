import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { parseNubankAccountCsv } from "../src/domain/nubankCsv.ts";
import { parseBackupFile } from "../src/domain/backupValidation.ts";
import { replaceTransactions } from "../src/db/restoreCore.ts";
import { stageNubankRowsCore, listBankImportItemsCore, reviewBankItemCore, countPendingCore } from "../src/db/nubankImportCore.ts";

const id = (n) => String(n).padStart(8, "0") + "-2222-4222-8222-222222222222";
const header = "Data,Valor,Identificador,Descrição\n";
const csv = header +
  "01/11/2026,-12.00," + id(1) + ",Compra no débito - FARMACIA TESTE\n" +
  "02/11/2026,-25.00," + id(2) + ",Compra no débito - FARMACIA TESTE\n";

function makeDb(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    execAsync: async (sql) => { sqlite.exec(sql); },
    getFirstAsync: async (sql, p=[]) => sqlite.prepare(sql).get(...p) ?? null,
    getAllAsync: async (sql, p=[]) => sqlite.prepare(sql).all(...p),
    runAsync: async (sql, p=[]) => {
      const result = sqlite.prepare(sql).run(...p);
      return { changes:Number(result.changes), lastInsertRowId:Number(result.lastInsertRowid) };
    },
    withTransactionAsync: async (fn) => atomic(sqlite,fn),
  };
  return { sqlite, db };
}
async function atomic(sqlite, fn) {
  sqlite.exec("BEGIN;");
  try { const result = await fn(); sqlite.exec("COMMIT;"); return result; }
  catch(error) { sqlite.exec("ROLLBACK;"); throw error; }
}

async function createSource(t) {
  const {sqlite,db}=makeDb(t);
  await migrateDatabase(db);
  await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(csv)));
  const first=(await listBankImportItemsCore(db))[0];
  await atomic(sqlite,()=>reviewBankItemCore(db,{
    itemId:first.id,action:"import",category:"health",applyToSimilar:false,rememberRule:true,
  }));
  return {sqlite,db};
}
async function backup(db) {
  return parseBackupFile({
    version:2,
    exportedAt:1_700_000_000_000,
    transactions:await db.getAllAsync("SELECT * FROM transactions;"),
    bankImportRows:await db.getAllAsync("SELECT * FROM bank_import_rows;"),
    bankImportRules:await db.getAllAsync("SELECT * FROM bank_import_rules;"),
  });
}

test("backup v2 conserva pendências, regras e transações na restauração",async(t)=>{
  const src=await createSource(t);
  const file=await backup(src.db);
  assert.equal(file.version,2);
  assert.equal(file.transactions.length,1);
  assert.equal(file.bankImportRows.length,2);
  assert.equal(file.bankImportRules.length,1);
  const dest=makeDb(t);
  await migrateDatabase(dest.db);
  await atomic(dest.sqlite,()=>replaceTransactions(dest.db,file));
  assert.equal(dest.sqlite.prepare("SELECT COUNT(*) AS n FROM transactions;").get().n,1);
  assert.equal(await countPendingCore(dest.db),1);
  assert.equal(dest.sqlite.prepare("SELECT COUNT(*) AS n FROM bank_import_rules;").get().n,1);
  const again=await atomic(dest.sqlite,()=>stageNubankRowsCore(dest.db,parseNubankAccountCsv(csv)));
  assert.deepEqual(again,{created:0,repeated:2});
  assert.equal(await countPendingCore(dest.db),1);
});

test("restauração v2 inválida não altera SQLite existente",async(t)=>{
  const src=await createSource(t);
  const file=await backup(src.db);
  const malformed=structuredClone(file);
  malformed.bankImportRows[0].transactionId=123456789;
  assert.throws(()=>parseBackupFile(malformed), /transação ausente/);
  assert.equal(src.sqlite.prepare("SELECT COUNT(*) AS n FROM bank_import_rows;").get().n,2);
});

test("erro em tabela de importação reverte todas as alterações da restauração",async(t)=>{
  const src=await createSource(t);
  const file=await backup(src.db);
  const dest=makeDb(t);
  await migrateDatabase(dest.db);
  await atomic(dest.sqlite,()=>stageNubankRowsCore(dest.db,parseNubankAccountCsv(header+
    "03/11/2026,-50.00,"+id(3)+",Compra no débito - OUTRA LOJA\n")));
  const before=dest.sqlite.prepare("SELECT sourceId FROM bank_import_rows;").get().sourceId;
  dest.sqlite.exec("CREATE TRIGGER stop_restore BEFORE INSERT ON bank_import_rules BEGIN SELECT RAISE(ABORT, 'teste-rollback'); END;");
  await assert.rejects(
    ()=>atomic(dest.sqlite,()=>replaceTransactions(dest.db,file)),
    /teste-rollback/,
  );
  const rows=dest.sqlite.prepare("SELECT sourceId FROM bank_import_rows;").all();
  assert.deepEqual(rows.map(r=>r.sourceId),[before]);
  assert.equal(dest.sqlite.prepare("SELECT COUNT(*) AS n FROM transactions;").get().n,0);
});

test("parser v2 bloqueia ID duplicado, regra duplicada e versão superior",async(t)=>{
  const src=await createSource(t);
  const file=await backup(src.db);
  const duplicate=structuredClone(file);
  duplicate.bankImportRows.push({...duplicate.bankImportRows[0],id:99});
  assert.throws(()=>parseBackupFile(duplicate),/duplicada/);
  const dupRule=structuredClone(file);
  dupRule.bankImportRules.push({...dupRule.bankImportRules[0],id:99});
  assert.throws(()=>parseBackupFile(dupRule),/duplicada/);
  assert.throws(()=>parseBackupFile({...file,version:3}),/Versão de backup/);
});

test("backup legado v1 segue aceito; não inventa regras ou pendências",async(t)=>{
  const src=await createSource(t);
  const file=await backup(src.db);
  const old=parseBackupFile({
    version:1,exportedAt:file.exportedAt,transactions:file.transactions,
  });
  assert.equal(old.version,1);
  assert.deepEqual(old.bankImportRows,[]);
  assert.deepEqual(old.bankImportRules,[]);
  const dest=makeDb(t);
  await migrateDatabase(dest.db);
  await atomic(dest.sqlite,()=>replaceTransactions(dest.db,old));
  assert.equal(dest.sqlite.prepare("SELECT COUNT(*) AS n FROM transactions;").get().n,1);
  assert.equal(dest.sqlite.prepare("SELECT COUNT(*) AS n FROM bank_import_rows;").get().n,0);
});
