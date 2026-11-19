import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { parseNubankAccountCsv } from "../src/domain/nubankCsv.ts";
import { parseBackupFile } from "../src/domain/backupValidation.ts";
import { replaceTransactions } from "../src/db/restoreCore.ts";
import {
  listImportBatchesCore, listImportBatchEventsCore, stageNubankRowsCore,
  reviewBankItemCore, cancelPendingBatchCore, listBankImportItemsCore,
} from "../src/db/nubankImportCore.ts";
import {
  previewBankBatchReversalCore, reverseBankBatchCore,
} from "../src/db/bankBatchRollback.ts";

const header="Data,Valor,Identificador,Descrição\n";
const id=n=>String(n).padStart(8,"0")+"-2222-4222-8222-222222222222";
const debit=(n,v="24.18")=>"15/05/2026,-"+v+","+id(n)+",Compra no débito - OXXO PISCINAS\n";
function setup(t) {
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  const db={
    execAsync:async sql=>{sqlite.exec(sql);},
    getFirstAsync:async(sql,p=[])=>sqlite.prepare(sql).get(...p)??null,
    getAllAsync:async(sql,p=[])=>sqlite.prepare(sql).all(...p),
    runAsync:async(sql,p=[])=>{
      const r=sqlite.prepare(sql).run(...p);
      return {changes:Number(r.changes),lastInsertRowId:Number(r.lastInsertRowid)};
    },
    withTransactionAsync:async fn=>atomic(sqlite,fn),
  };
  return {db,sqlite};
}
async function atomic(sqlite,fn){
  sqlite.exec("BEGIN;");
  try{const result=await fn();sqlite.exec("COMMIT;");return result;}
  catch(e){sqlite.exec("ROLLBACK;");throw e;}
}
async function makeBatch(t){
  const {db,sqlite}=setup(t);
  await migrateDatabase(db);
  await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(
    header+debit(1)+debit(2,"16.99")+debit(3,"35.10")
  )));
  const batch=(await listImportBatchesCore(db))[0];
  const items=await listBankImportItemsCore(db);
  for(const item of items.slice(0,2)){
    await atomic(sqlite,()=>reviewBankItemCore(db,{
      itemId:item.id,action:"import",category:"food",
      applyToSimilar:false,rememberRule:false,
    }));
  }
  return {db,sqlite,batch};
}
const active=sqlite=>Number(sqlite.prepare(
  "SELECT COUNT(*) AS n FROM transactions WHERE deletedAt IS NULL;"
).get().n);

test("prévia identifica somente importações próprias, não um lançamento manual igual",async t=>{
  const {db,sqlite,batch}=await makeBatch(t);
  await db.runAsync(
    "INSERT INTO transactions (dateISO,type,amountCents,title,createdAt,updatedAt,category) VALUES (?,?,?,?,?,?,?)",
    ["2026-05-15","expense",2418,"Oxxo",1000,1000,"food"],
  );
  const p=await previewBankBatchReversalCore(db,batch.createdAt);
  assert.equal(p.eligible.length,2);
  assert.equal(p.blocked.length,0);
  assert.equal(p.expenseCents,3510+1699);
  assert.equal(active(sqlite),3);
  const result=await atomic(sqlite,()=>reverseBankBatchCore(db,p));
  assert.equal(result.reversed,2);
  assert.equal(active(sqlite),1);
  assert.equal(sqlite.prepare("SELECT title FROM transactions WHERE deletedAt IS NULL;").get().title,"Oxxo");
  assert.equal((await listImportBatchEventsCore(db,batch.createdAt))[0].action,"approved_reversed");
  assert.equal((await listImportBatchesCore(db))[0].reverted,2);
  assert.equal((await listImportBatchesCore(db))[0].pending,1);
  const replay=await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(header+debit(1)+debit(2,"16.99"))));
  assert.deepEqual(replay,{created:0,repeated:2});
});

test("não reverte transação que foi editada, mas pode reverter as intocadas",async t=>{
  const {db,sqlite,batch}=await makeBatch(t);
  const rows=sqlite.prepare("SELECT id FROM transactions ORDER BY id;").all();
  await db.runAsync("UPDATE transactions SET title=?, updatedAt=updatedAt+100 WHERE id=?",
    ["Compra editada manualmente",rows[0].id]);
  const preview=await previewBankBatchReversalCore(db,batch.createdAt);
  assert.equal(preview.blocked.length,1);
  assert.equal(preview.eligible.length,1);
  const result=await atomic(sqlite,()=>reverseBankBatchCore(db,preview));
  assert.equal(result.reversed,1);
  assert.equal(result.blocked,1);
  assert.equal(active(sqlite),1);
  assert.equal(sqlite.prepare("SELECT title FROM transactions WHERE deletedAt IS NULL").get().title,"Compra editada manualmente");
});

test("prévia desatualizada aborta toda reversão sem mexer no banco",async t=>{
  const {db,sqlite,batch}=await makeBatch(t);
  const p=await previewBankBatchReversalCore(db,batch.createdAt);
  const tx=p.eligible[0].transactionId;
  await db.runAsync("UPDATE transactions SET amountCents=amountCents+1, updatedAt=updatedAt+1 WHERE id=?",[tx]);
  await assert.rejects(()=>atomic(sqlite,()=>reverseBankBatchCore(db,p)),/mudaram depois da prévia/);
  assert.equal(active(sqlite),2);
  assert.equal((await listImportBatchEventsCore(db,batch.createdAt)).length,0);
});

test("falha SQL durante reversão reverte soft deletes e evento",async t=>{
  const {db,sqlite,batch}=await makeBatch(t);
  const p=await previewBankBatchReversalCore(db,batch.createdAt);
  sqlite.exec("CREATE TRIGGER rollback_test BEFORE INSERT ON bank_import_batch_events BEGIN SELECT RAISE(ABORT,'falha-forcada'); END;");
  await assert.rejects(()=>atomic(sqlite,()=>reverseBankBatchCore(db,p)),/falha-forcada/);
  assert.equal(active(sqlite),2);
  assert.equal((await listImportBatchEventsCore(db,batch.createdAt)).length,0);
});

test("cancelamento completo fica no histórico e não exclui registros manuais",async t=>{
  const {db,sqlite,batch}=await makeBatch(t);
  const result=await atomic(sqlite,()=>cancelPendingBatchCore(db,batch.createdAt));
  assert.deepEqual(result,{cancelled:1,preservedReviewed:2});
  const history=await listImportBatchesCore(db);
  assert.equal(history[0].pending,0);
  assert.equal(history[0].cancelled,1);
  assert.equal(history[0].imported,2);
  assert.equal(history[0].total,3);
  assert.equal((await listImportBatchEventsCore(db,batch.createdAt))[0].action,"pending_cancelled");
  assert.equal(active(sqlite),2);
});

test("backup v3 conserva histórico/reversões; restauração v2 reconstrói lotes",async t=>{
  const src=await makeBatch(t);
  await atomic(src.sqlite,()=>cancelPendingBatchCore(src.db,src.batch.createdAt));
  const p=await previewBankBatchReversalCore(src.db,src.batch.createdAt);
  await atomic(src.sqlite,()=>reverseBankBatchCore(src.db,p));
  const input={
    version:3,exportedAt:Date.now(),
    transactions:await src.db.getAllAsync("SELECT * FROM transactions"),
    bankImportRows:await src.db.getAllAsync("SELECT * FROM bank_import_rows"),
    bankImportRules:await src.db.getAllAsync("SELECT * FROM bank_import_rules"),
    bankImportBatches:await src.db.getAllAsync("SELECT * FROM bank_import_batches"),
    bankImportEvents:await src.db.getAllAsync("SELECT * FROM bank_import_batch_events"),
  };
  const parsed=parseBackupFile(input);
  const dst=setup(t);
  await migrateDatabase(dst.db);
  await atomic(dst.sqlite,()=>replaceTransactions(dst.db,parsed));
  assert.equal((await listImportBatchesCore(dst.db))[0].cancelled,1);
  assert.equal((await listImportBatchesCore(dst.db))[0].reverted,2);
  assert.equal((await listImportBatchEventsCore(dst.db,src.batch.createdAt)).length,2);
  assert.equal(active(dst.sqlite),0);
  const invalid=structuredClone(input);
  invalid.bankImportEvents[0].batchCreatedAt=999;
  assert.throws(()=>parseBackupFile(invalid),/Evento refere lote ausente/);
  const old={
    version:2,exportedAt:Date.now(),transactions:input.transactions,
    bankImportRows:input.bankImportRows,bankImportRules:input.bankImportRules,
  };
  await atomic(dst.sqlite,()=>replaceTransactions(dst.db,parseBackupFile(old)));
  assert.equal((await listImportBatchesCore(dst.db))[0].cancelled,0);
  assert.equal((await listImportBatchEventsCore(dst.db,src.batch.createdAt)).length,0);
});
