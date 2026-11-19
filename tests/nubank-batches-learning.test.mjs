import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { parseNubankAccountCsv } from "../src/domain/nubankCsv.ts";
import {
  stageNubankRowsCore, listBankImportItemsCore, countPendingCore,
  listImportBatchesCore, cancelPendingBatchCore,
  brandPrefix, getPendingCategoryGroupCore, categorizePendingGroupCore,
  getLearnedCategoryCore, reviewBankItemCore,
} from "../src/db/nubankImportCore.ts";

const id=(n)=>String(n).padStart(8,"0")+"-1111-4111-8111-111111111111";
const hdr="Data,Valor,Identificador,Descrição\n";
const row=(n,title="OXXO PISCINAS")=>
  "15/05/2026,-24.18,"+id(n)+",Compra no débito - "+title+"\n";
function setup(t) {
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  const db={
    execAsync:async sql=>{sqlite.exec(sql);},
    getFirstAsync:async (sql,p=[])=>sqlite.prepare(sql).get(...p)??null,
    getAllAsync:async (sql,p=[])=>sqlite.prepare(sql).all(...p),
    runAsync:async (sql,p=[])=>{
      const res=sqlite.prepare(sql).run(...p);
      return {changes:Number(res.changes),lastInsertRowId:Number(res.lastInsertRowid)};
    },
    withTransactionAsync:async fn=>atomic(sqlite,fn),
  };
  return {sqlite,db};
}
async function atomic(sqlite,fn){
  sqlite.exec("BEGIN;");
  try{const v=await fn();sqlite.exec("COMMIT;");return v;}
  catch(e){sqlite.exec("ROLLBACK;");throw e;}
}
async function seed(t) {
  const {sqlite,db}=setup(t);
  await migrateDatabase(db);
  const rows=parseNubankAccountCsv(hdr+
    row(1,"OXXO PISCINAS")+row(2,"OXXO CAMBUI")+
    row(3,"OXXO PISCINAS")+row(4,"VILA SUPERMERCADOS CAM")+
    row(5,"CLARO"));
  await atomic(sqlite,()=>stageNubankRowsCore(db,rows));
  return {sqlite,db};
}

test("primeira palavra de marca agrupa OXXO mas nao nomes genericos ou Pix",()=>{
  assert.equal(brandPrefix("DEBIT:OXXO PISCINAS"),"DEBIT:OXXO");
  assert.equal(brandPrefix("DEBIT:OXXO"),"DEBIT:OXXO");
  assert.equal(brandPrefix("DEBIT:SUPERMERCADO VILA"),null);
  assert.equal(brandPrefix("PIX_OUT:OXXO"),null);
  assert.equal(brandPrefix("DEBIT:ABC"),null);
});

test("classifica OXXO PISCINAS e OXXO CAMBUI sem criar lançamentos",async t=>{
  const {sqlite,db}=await seed(t);
  const base=(await listBankImportItemsCore(db)).find(x=>x.merchantKey==="DEBIT:OXXO PISCINAS");
  const count=await getPendingCategoryGroupCore(db,base.id,"brand");
  assert.equal(count.count,3);
  assert.equal(count.label,"OXXO");
  assert.deepEqual(count.examples,["DEBIT:OXXO CAMBUI","DEBIT:OXXO PISCINAS"]);
  const n=await atomic(sqlite,()=>categorizePendingGroupCore(db,base.id,"food","brand"));
  assert.equal(n,3);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions").get().n,0);
  const changed=(await listBankImportItemsCore(db)).filter(x=>x.merchantKey.startsWith("DEBIT:OXXO"));
  assert.equal(changed.length,3);
  assert.ok(changed.every(x=>x.category==="food"&&x.status==="pending"));
  const untouched=(await listBankImportItemsCore(db)).find(x=>x.merchantKey.includes("VILA"));
  assert.equal(untouched.category,null);
});

test("classificar em lote respeita categoria ja escolhida e entrada invalida falha",async t=>{
  const {sqlite,db}=await seed(t);
  const a=(await listBankImportItemsCore(db)).find(x=>x.merchantKey==="DEBIT:OXXO CAMBUI");
  await db.runAsync("UPDATE bank_import_rows SET category='other' WHERE id=?",[a.id]);
  const item=(await listBankImportItemsCore(db)).find(x=>x.merchantKey==="DEBIT:OXXO PISCINAS");
  assert.equal((await getPendingCategoryGroupCore(db,item.id,"brand")).count,2);
  const count=await atomic(sqlite,()=>categorizePendingGroupCore(db,item.id,"food","brand"));
  assert.equal(count,2);
  assert.equal(sqlite.prepare("SELECT category FROM bank_import_rows WHERE id=?").get(a.id).category,"other");
  await assert.rejects(
    ()=>atomic(sqlite,()=>categorizePendingGroupCore(db,item.id,"salary","brand")),
    /Categoria de despesa não reconhecida/,
  );
});

test("abandonar lote descarta apenas pendentes e preserva aprovados e regras",async t=>{
  const {sqlite,db}=await seed(t);
  const batch=(await listImportBatchesCore(db))[0];
  assert.equal(batch.total,5);
  assert.equal(batch.pending,5);
  const item=(await listBankImportItemsCore(db))[0];
  await atomic(sqlite,()=>reviewBankItemCore(db,{
    itemId:item.id,action:"import",category:"food",
    applyToSimilar:false,rememberRule:true,
  }));
  const result=await atomic(sqlite,()=>cancelPendingBatchCore(db,batch.createdAt));
  assert.deepEqual(result,{cancelled:4,preservedReviewed:1});
  assert.equal(await countPendingCore(db),0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE deletedAt IS NULL").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_import_rules").get().n,1);
  const restaged=await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(hdr+row(1)+row(2,"OXXO CAMBUI")+row(3)+row(4,"VILA SUPERMERCADOS CAM")+row(5,"CLARO"))));
  assert.deepEqual(restaged,{created:4,repeated:1});
  await assert.rejects(()=>cancelPendingBatchCore(db,-1),/Lote de importação inválido/);
});

test("cancelar somente lote selecionado, preservando outras importações",async t=>{
  const {sqlite,db}=await seed(t);
  const original=(await listImportBatchesCore(db))[0].createdAt;
  // Simula o arquivo anterior, com identificador do lote distinto.
  await db.runAsync("UPDATE bank_import_rows SET createdAt=? WHERE sourceId=?",[original-100000,id(1)]);
  const batches=await listImportBatchesCore(db);
  assert.equal(batches.length,2);
  await atomic(sqlite,()=>cancelPendingBatchCore(db,original));
  assert.equal(await countPendingCore(db),1);
  const remaining=(await listBankImportItemsCore(db))[0];
  assert.equal(remaining.sourceId,id(1));
});

test("aprende categoria a partir de Oxxo manual e recusa historico contraditorio",async t=>{
  const {db}=await seed(t);
  await db.runAsync(
    "INSERT INTO transactions(dateISO,type,amountCents,title,createdAt,updatedAt,category) VALUES (?,?,?,?,?,?,?)",
    ["2026-05-15","expense",2418,"Oxxo",123,123,"food"],
  );
  let learned=await getLearnedCategoryCore(db,"DEBIT:OXXO PISCINAS","expense");
  assert.equal(learned.category,"food");
  assert.equal(learned.exampleTitle,"Oxxo");
  await db.runAsync(
    "INSERT INTO transactions(dateISO,type,amountCents,title,createdAt,updatedAt,category) VALUES (?,?,?,?,?,?,?)",
    ["2026-05-20","expense",5000,"Oxxo",124,124,"other"],
  );
  learned=await getLearnedCategoryCore(db,"DEBIT:OXXO PISCINAS","expense");
  assert.equal(learned,null);
});

test("historico Claro sugere categoria sem converter Pix em receita",async t=>{
  const {db}=await seed(t);
  await db.runAsync(
    "INSERT INTO transactions(dateISO,type,amountCents,title,createdAt,updatedAt,category) VALUES (?,?,?,?,?,?,?)",
    ["2026-05-15","expense",5000,"Claro",123,123,"other"],
  );
  const learned=await getLearnedCategoryCore(db,"PIX_OUT:CLARO","expense");
  assert.equal(learned.category,"other");
  assert.equal(await getLearnedCategoryCore(db,"PIX_IN:CLARO","income"),null);
});
