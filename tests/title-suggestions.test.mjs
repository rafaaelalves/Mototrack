import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { suggestTransactionTitlesCore } from "../src/db/titleSuggestions.ts";

function setup(t) {
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  const db={
    execAsync:async sql=>{sqlite.exec(sql);},
    getFirstAsync:async(sql,p=[])=>sqlite.prepare(sql).get(...p)??null,
    getAllAsync:async(sql,p=[])=>sqlite.prepare(sql).all(...p),
    withTransactionAsync:async fn=>{
      sqlite.exec("BEGIN");
      try{const r=await fn();sqlite.exec("COMMIT");return r;}
      catch(e){sqlite.exec("ROLLBACK");throw e;}
    },
  };
  return {db,sqlite};
}
async function seed(t){
  const {db,sqlite}=setup(t);
  await migrateDatabase(db);
  const insert=sqlite.prepare(
    "INSERT INTO transactions (dateISO,type,amountCents,title,category,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)",
  );
  insert.run("2026-05-01","expense",1000,"Oxxo","food",1,1);
  insert.run("2026-05-02","expense",1500,"Oxxo","food",2,2);
  insert.run("2026-05-03","expense",5000,"Claro","other",3,3);
  insert.run("2026-05-04","income",300000,"Salário","salary",4,4);
  insert.run("2026-05-05","expense",1600,"Oxxo PISCINAS","food",5,5);
  return {db,sqlite};
}
test("digitar Oxxo sugere nome e categoria historicos, sem inserir nada",async t=>{
  const {db,sqlite}=await seed(t);
  const results=await suggestTransactionTitlesCore(db,"Oxx","expense");
  assert.equal(results[0].title,"Oxxo");
  assert.equal(results[0].category,"food");
  assert.equal(results[0].occurrences,2);
  assert.ok(results.some(x=>x.title==="Oxxo PISCINAS"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions").get().n,5);
});
test("Claro e salário sao categorias diferentes e pesquisaveis localmente",async t=>{
  const {db}=await seed(t);
  assert.equal((await suggestTransactionTitlesCore(db,"CLÁRO","expense"))[0].category,"other");
  assert.equal((await suggestTransactionTitlesCore(db,"sal","income"))[0].category,"salary");
  assert.deepEqual(await suggestTransactionTitlesCore(db,"sal","expense"),[]);
});
test("buscas curtas nao sobrecarregam o SQLite; exclusao logica nao aparece",async t=>{
  const {db,sqlite}=await seed(t);
  assert.deepEqual(await suggestTransactionTitlesCore(db,"o","expense"),[]);
  sqlite.exec("UPDATE transactions SET deletedAt=999 WHERE title='Claro'");
  assert.deepEqual(await suggestTransactionTitlesCore(db,"cla","expense"),[]);
  await assert.rejects(()=>suggestTransactionTitlesCore(db,"oxxo","expense",0),/Consulta inválida/);
});
