import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase, DATABASE_VERSION } from "../src/db/migrations.ts";
import { parseBackupFile } from "../src/domain/backupValidation.ts";
import { replaceTransactions } from "../src/db/restoreCore.ts";
import { parseNubankAccountCsv } from "../src/domain/nubankCsv.ts";
import {
  analyzeSmartBatchCore, createReadyPreview, approveReadyBatchCore,
  mergeExistingBankRowCore, unmergeBankRowCore, skipBankRowCore, rememberCategoryGroupCore,
  reopenExcludedBankRowCore, listExcludedBankRowsCore,
  listImportBatchesCore, listBankImportItemsCore, stageNubankRowsCore,
} from "../src/db/nubankImportCore.ts";

const id=n=>String(n).padStart(8,"0")+"-4444-4444-8444-444444444444";
const h="Data,Valor,Identificador,Descrição\n";
const item=(n,v,merchant="OXXO PISCINAS",date="15/05/2026")=>
  date+",-"+v+","+id(n)+",Compra no débito - "+merchant+"\n";
function setup(t){
  const sql=new DatabaseSync(":memory:");
  t.after(()=>sql.close());
  const db={
    execAsync:async q=>{sql.exec(q);},
    getFirstAsync:async(q,p=[])=>sql.prepare(q).get(...p)??null,
    getAllAsync:async(q,p=[])=>sql.prepare(q).all(...p),
    runAsync:async(q,p=[])=>{
      const r=sql.prepare(q).run(...p);
      return {changes:Number(r.changes),lastInsertRowId:Number(r.lastInsertRowid)};
    },
    withTransactionAsync:async f=>atomic(sql,f),
  };
  return {sql,db};
}
async function atomic(sql,fn){
  sql.exec("BEGIN");
  try{const r=await fn();sql.exec("COMMIT");return r;}
  catch(e){sql.exec("ROLLBACK");throw e;}
}
async function seed(t){
  const {sql,db}=setup(t);
  await migrateDatabase(db);
  await db.runAsync(
    "INSERT INTO transactions(dateISO,type,amountCents,title,category,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)",
    ["2026-05-15","expense",2418,"Oxxo","food",10,10],
  );
  const csv=h+item(1,"24.18")+item(2,"16.99","POSTO SHELL")+
    item(3,"11.50","NOVA LOJA")+item(4,"8.35","OXXO CAMBUI")+
    item(5,"12.00","OUTRO");
  await atomic(sql,()=>stageNubankRowsCore(db,parseNubankAccountCsv(csv)));
  const batch=(await listImportBatchesCore(db))[0];
  return {sql,db,batch};
}
const active=sql=>Number(sql.prepare(
  "SELECT COUNT(*) AS n FROM transactions WHERE deletedAt IS NULL").get().n);

test("análise distingue pronta, duplicata e categoria desconhecida sem alterar saldo",async t=>{
  const {sql,db,batch}=await seed(t);
  const a=await analyzeSmartBatchCore(db,batch.createdAt);
  assert.equal(a.count,5);
  assert.equal(a.duplicate,1);
  assert.equal(a.ready,2);
  assert.equal(a.category,2);
  assert.equal(a.nonAccounting,0);
  assert.equal(active(sql),1);
  assert.equal(a.items.find(x=>x.amountCents===2418).status,"duplicate");
  assert.equal(a.items.find(x=>x.amountCents===1699).category,"fuel");
  assert.equal(a.items.find(x=>x.amountCents===835).category,"food");
});

test("mesclar vincula dados do banco ao manual sem duplicar nem sobrescrever campos",async t=>{
  const {sql,db,batch}=await seed(t);
  const row=(await analyzeSmartBatchCore(db,batch.createdAt)).items.find(x=>x.status==="duplicate");
  const before=sql.prepare("SELECT * FROM transactions WHERE id=1").get();
  await atomic(sql,()=>mergeExistingBankRowCore(db,row.id,1));
  assert.deepEqual(sql.prepare("SELECT * FROM transactions WHERE id=1").get(),before);
  assert.equal(active(sql),1);
  const merged=sql.prepare("SELECT * FROM bank_import_rows WHERE id=?").get(row.id);
  assert.equal(merged.status,"merged");
  assert.equal(merged.transactionId,1);
  assert.equal(merged.resolutionReason,"linked_existing");
  assert.equal((await listImportBatchesCore(db))[0].merged,1);
  await assert.rejects(()=>mergeExistingBankRowCore(db,row.id,1),/não está mais pendente/);
  const backup=parseBackupFile({
    version:4,exportedAt:Date.now(),
    transactions:await db.getAllAsync("SELECT * FROM transactions"),
    bankImportRows:await db.getAllAsync("SELECT * FROM bank_import_rows"),
    bankImportRules:await db.getAllAsync("SELECT * FROM bank_import_rules"),
    bankImportBatches:await db.getAllAsync("SELECT * FROM bank_import_batches"),
    bankImportEvents:await db.getAllAsync("SELECT * FROM bank_import_batch_events"),
  });
  const other=setup(t);
  await migrateDatabase(other.db);
  await atomic(other.sql,()=>replaceTransactions(other.db,backup));
  assert.equal(other.sql.prepare("SELECT status FROM bank_import_rows WHERE id=?").get(row.id).status,"merged");
  assert.equal(active(other.sql),1);
});

test("desfazer mesclagem devolve pendência sem editar transação original",async t=>{
  const {sql,db,batch}=await seed(t);
  const row=(await analyzeSmartBatchCore(db,batch.createdAt)).items.find(x=>x.status==="duplicate");
  const before=sql.prepare("SELECT * FROM transactions WHERE id=1").get();
  await atomic(sql,()=>mergeExistingBankRowCore(db,row.id,1));
  await atomic(sql,()=>unmergeBankRowCore(db,row.id));
  assert.deepEqual(sql.prepare("SELECT * FROM transactions WHERE id=1").get(),before);
  const bank=sql.prepare("SELECT status,transactionId,resolutionReason FROM bank_import_rows WHERE id=?").get(row.id);
  assert.equal(bank.status,"pending");
  assert.equal(bank.transactionId,null);
  assert.equal(bank.resolutionReason,null);
  assert.equal((await analyzeSmartBatchCore(db,batch.createdAt)).duplicate,1);
  await assert.rejects(()=>unmergeBankRowCore(db,row.id),/já foi desfeito/);
});

test("aprovação em lote importa só itens prontos e preserva candidato duplicado",async t=>{
  const {sql,db,batch}=await seed(t);
  const analysis=await analyzeSmartBatchCore(db,batch.createdAt);
  const preview=createReadyPreview(analysis);
  assert.equal(preview.entries.length,2);
  const result=await atomic(sql,()=>approveReadyBatchCore(db,preview));
  assert.equal(result.created,2);
  assert.equal(active(sql),3);
  const pending=await analyzeSmartBatchCore(db,batch.createdAt);
  assert.equal(pending.duplicate,1);
  assert.equal(pending.category,2);
  assert.equal(pending.ready,0);
  await assert.rejects(()=>atomic(sql,()=>approveReadyBatchCore(db,preview)),/análise mudou/);
  assert.equal(active(sql),3);
});

test("mudança após prévia cancela tudo; nova coincidência também bloqueia",async t=>{
  const {sql,db,batch}=await seed(t);
  const preview=createReadyPreview(await analyzeSmartBatchCore(db,batch.createdAt));
  const first=preview.entries[0];
  await db.runAsync("UPDATE bank_import_rows SET category='other' WHERE id=?",[first.id]);
  await assert.rejects(()=>atomic(sql,()=>approveReadyBatchCore(db,preview)),/análise mudou/);
  assert.equal(active(sql),1);
  const fresh=createReadyPreview(await analyzeSmartBatchCore(db,batch.createdAt));
  const ready=fresh.entries[0];
  const record=sql.prepare("SELECT dateISO,type,amountCents FROM bank_import_rows WHERE id=?").get(ready.id);
  await db.runAsync(
    "INSERT INTO transactions(dateISO,type,amountCents,title,category,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)",
    [record.dateISO,record.type,record.amountCents,"Manual posterior","food",101,101],
  );
  await assert.rejects(()=>atomic(sql,()=>approveReadyBatchCore(db,fresh)),/análise mudou/);
  assert.equal(active(sql),2);
});

test("falha SQL no meio de múltiplas importações reverte todo o conjunto",async t=>{
  const {sql,db,batch}=await seed(t);
  const preview=createReadyPreview(await analyzeSmartBatchCore(db,batch.createdAt));
  sql.exec("CREATE TRIGGER reject_second BEFORE INSERT ON transactions " +
    "WHEN NEW.amountCents=1699 BEGIN SELECT RAISE(ABORT,'falha-simulada'); END;");
  await assert.rejects(()=>atomic(sql,()=>approveReadyBatchCore(db,preview)),/falha-simulada/);
  assert.equal(active(sql),1);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM bank_import_rows WHERE status='imported'").get().n,0);
});

test("não contabilizar guarda motivo sem alterar lançamentos",async t=>{
  const {sql,db,batch}=await seed(t);
  const analysis=await analyzeSmartBatchCore(db,batch.createdAt);
  const row=analysis.items.find(x=>x.amountCents===1150);
  await atomic(sql,()=>skipBankRowCore(db,row.id,"own_transfer"));
  const saved=sql.prepare("SELECT status,resolutionReason FROM bank_import_rows WHERE id=?").get(row.id);
  assert.equal(saved.status,"transfer");
  assert.equal(saved.resolutionReason,"own_transfer");
  assert.equal(active(sql),1);
});

test("desfazer 'não importar' devolve para revisão sem criar transação",async t=>{
  const {sql,db,batch}=await seed(t);
  const row=(await analyzeSmartBatchCore(db,batch.createdAt)).items.find(x=>x.amountCents===1150);
  await atomic(sql,()=>skipBankRowCore(db,row.id,"duplicate_rejected"));
  assert.equal((await listExcludedBankRowsCore(db,batch.createdAt)).length,1);
  assert.equal(active(sql),1);
  await atomic(sql,()=>reopenExcludedBankRowCore(db,row.id));
  const again=sql.prepare("SELECT status,resolutionReason,transactionId FROM bank_import_rows WHERE id=?").get(row.id);
  assert.equal(again.status,"pending");
  assert.equal(again.resolutionReason,null);
  assert.equal(again.transactionId,null);
  assert.equal(active(sql),1);
  await assert.rejects(()=>reopenExcludedBankRowCore(db,row.id),/já foi desfeita/);
});

test("categorizar semelhantes e lembrar regra não cria despesas nem aprova duplicatas",async t=>{
  const {sql,db,batch}=await seed(t);
  const a=await analyzeSmartBatchCore(db,batch.createdAt);
  const row=a.items.find(x=>x.amountCents===835);
  const result=await atomic(sql,()=>rememberCategoryGroupCore(db,row.id,"food","brand"));
  assert.ok(result.rules>=2);
  assert.equal(active(sql),1);
  const dup=(await analyzeSmartBatchCore(db,batch.createdAt)).items.find(x=>x.amountCents===2418);
  assert.equal(dup.status,"duplicate");
  const rule=sql.prepare("SELECT category FROM bank_import_rules WHERE merchantKey='DEBIT:OXXO PISCINAS'").get();
  assert.equal(rule.category,"food");
});

test("duplicação dentro do CSV é exceção, não deve quebrar lote",async t=>{
  const {db,sql}=setup(t);
  await migrateDatabase(db);
  await atomic(sql,()=>stageNubankRowsCore(db,parseNubankAccountCsv(
    h+item(1,"10.50")+item(2,"10.50")+item(3,"11.50","POSTO SHELL")
  )));
  const batch=(await listImportBatchesCore(db))[0];
  const a=await analyzeSmartBatchCore(db,batch.createdAt);
  assert.equal(a.duplicate,2);
  assert.equal(a.ready,1);
  assert.equal(createReadyPreview(a).entries.length,1);
});

test("migração v3→v4 conserva dados e adiciona estado mesclado",async t=>{
  const {sql,db,batch}=await seed(t);
  // Reconstituir tabela v3 com os dados atuais para testar o caminho incremental.
  sql.exec("ALTER TABLE bank_import_rows RENAME TO bank_import_rows_v4;");
  sql.exec("CREATE TABLE bank_import_rows AS SELECT id,source,sourceId,dateISO,type,amountCents,description,merchantKey,suggestedCategory,suggestedAction,status,category,transactionId,createdAt,updatedAt FROM bank_import_rows_v4;");
  sql.exec("DROP TABLE bank_import_rows_v4;");
  sql.exec("PRAGMA user_version=3;");
  await migrateDatabase(db);
  assert.equal(sql.prepare("PRAGMA user_version").get().user_version,DATABASE_VERSION);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM bank_import_rows").get().n,5);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM bank_import_batches").get().n,1);
  assert.ok(sql.prepare("PRAGMA table_info(bank_import_rows)").all().some(c=>c.name==="resolutionReason"));
});
