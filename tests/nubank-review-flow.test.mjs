import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { parseNubankAccountCsv } from "../src/domain/nubankCsv.ts";
import {
  stageNubankRowsCore, listBankImportItemsCore, countPendingCore,
  getExistingTransactionMatchesCore, saveBankImportDraftCore,
  reviewBankItemCore,
} from "../src/db/nubankImportCore.ts";

const header = "Data,Valor,Identificador,Descrição\n";
const uuid = (n) => String(n).padStart(8,"0") + "-1111-4111-8111-111111111111";
function csvRow(n, merchant = "TESTE") {
  return "15/05/2026,-24.18," + uuid(n) + ",Compra no débito - " + merchant + "\n";
}
function setup(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    execAsync: async sql => { sqlite.exec(sql); },
    getFirstAsync: async (sql, args=[]) => sqlite.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql, args=[]) => sqlite.prepare(sql).all(...args),
    runAsync: async (sql, args=[]) => {
      const result = sqlite.prepare(sql).run(...args);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    withTransactionAsync: async fn => {
      sqlite.exec("BEGIN");
      try { const result = await fn(); sqlite.exec("COMMIT"); return result; }
      catch(e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  };
  return { sqlite, db };
}

test("mais de 100 pendências são alcançáveis por paginação e sem repetição", async (t) => {
  const { db } = setup(t);
  await migrateDatabase(db);
  const text = header + Array.from({length:135}, (_,i)=>csvRow(i+1,"LOJA " + (i+1))).join("");
  const rows = parseNubankAccountCsv(text);
  await stageNubankRowsCore(db, rows);
  assert.equal(await countPendingCore(db),135);
  const a = await listBankImportItemsCore(db, "pending", 50, 0);
  const b = await listBankImportItemsCore(db, "pending", 50, 50);
  const c = await listBankImportItemsCore(db, "pending", 50, 100);
  assert.deepEqual([a.length,b.length,c.length],[50,50,35]);
  assert.equal(new Set([...a,...b,...c].map(x=>x.id)).size,135);
  assert.equal(a[0].pendingGroupCount,1);
  await assert.rejects(()=>listBankImportItemsCore(db,"pending",50,-1),/página inválido/);
});

test("rascunho sobrevive à navegação, mas não entra nos lançamentos reais", async(t) => {
  const { db, sqlite } = setup(t);
  await migrateDatabase(db);
  await stageNubankRowsCore(db, parseNubankAccountCsv(header + csvRow(1)));
  const row = (await listBankImportItemsCore(db))[0];
  assert.equal(row.category, null);
  await saveBankImportDraftCore(db, row.id, "food");
  const after = (await listBankImportItemsCore(db))[0];
  assert.equal(after.category, "food");
  assert.equal(after.status, "pending");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions").get().n,0);
  await assert.rejects(()=>saveBankImportDraftCore(db,row.id,"salary"),/Categoria de rascunho inválida/);
  assert.equal((await listBankImportItemsCore(db))[0].category,"food");
});

test("a comparação revela o lançamento real do Mototrack, não só o número", async(t) => {
  const { db }=setup(t);
  await migrateDatabase(db);
  await stageNubankRowsCore(db,parseNubankAccountCsv(header+csvRow(1,"VILA SUPERMERCADOS CAM")));
  const row=(await listBankImportItemsCore(db))[0];
  assert.equal(row.suggestedCategory,"food");
  await db.runAsync(
    "INSERT INTO transactions (dateISO,type,amountCents,title,createdAt,updatedAt,category,distanceMeters) VALUES (?,?,?,?,?,?,?,?)",
    ["2026-05-15","expense",2418,"Compra cadastrada em maio",12345,12345,"food",null]
  );
  const list=(await listBankImportItemsCore(db))[0];
  assert.equal(list.similarCount,1);
  const matches=await getExistingTransactionMatchesCore(db,row.id);
  assert.equal(matches.length,1);
  assert.equal(matches[0].title,"Compra cadastrada em maio");
  assert.equal(matches[0].category,"food");
  assert.equal(matches[0].dateISO,"2026-05-15");
  assert.equal(matches[0].amountCents,2418);
  assert.equal(await getExistingTransactionMatchesCore(db,999999).then(x=>x.length),0);
});

test("uma loja tem contador de semelhantes, mas a regra não inclui lojas diferentes", async(t) => {
  const { db }=setup(t);
  await migrateDatabase(db);
  await stageNubankRowsCore(db,parseNubankAccountCsv(header +
    csvRow(1,"OXXO")+csvRow(2,"OXXO")+csvRow(3,"PADARIA")));
  const list=await listBankImportItemsCore(db);
  assert.equal(list.find(x=>x.description.includes("OXXO")).pendingGroupCount,2);
  const target=list.find(x=>x.description.includes("OXXO"));
  const result=await reviewBankItemCore(db,{
    itemId:target.id,action:"ignore",category:null,applyToSimilar:true,rememberRule:false,
  });
  assert.equal(result.reviewed,2);
  assert.equal(await countPendingCore(db),1);
});
