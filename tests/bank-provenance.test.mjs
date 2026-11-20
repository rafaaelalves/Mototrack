import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { getTransactionBankOrigin, visibleTransactionNotes } from "../src/db/bankProvenance.ts";
import { mergeExistingBankRowCore, stageNubankRowsCore } from "../src/db/nubankImportCore.ts";
import { parseNubankAccountCsv } from "../src/domain/nubankCsv.ts";
function setup(t) {
  const sql=new DatabaseSync(":memory:");
  t.after(()=>sql.close());
  const db={
    execAsync:async q=>sql.exec(q),
    getFirstAsync:async(q,p=[])=>sql.prepare(q).get(...p)??null,
    getAllAsync:async(q,p=[])=>sql.prepare(q).all(...p),
    runAsync:async(q,p=[])=>{
      const r=sql.prepare(q).run(...p);
      return {changes:Number(r.changes),lastInsertRowId:Number(r.lastInsertRowid)};
    },
    withTransactionAsync:async fn=>{
      sql.exec("BEGIN");
      try{const r=await fn();sql.exec("COMMIT");return r;}
      catch(e){sql.exec("ROLLBACK");throw e;}
    },
  };
  return {sql,db};
}
test("origem vinculada aparece separadamente, sem alterar observações manuais",async t=>{
  const {sql,db}=setup(t);
  await migrateDatabase(db);
  await db.runAsync(
    "INSERT INTO transactions(id,dateISO,type,amountCents,title,category,notes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
    [7,"2026-05-15","expense",2418,"Oxxo","food","Minha anotação pessoal",1,1],
  );
  await stageNubankRowsCore(db,parseNubankAccountCsv(
    "Data,Valor,Identificador,Descrição\n"+
    "15/05/2026,-24.18,12345678-4444-4444-8444-444444444444,Compra no débito - OXXO PISCINAS\n"
  ));
  const row=sql.prepare("SELECT id FROM bank_import_rows").get();
  await mergeExistingBankRowCore(db,Number(row.id),7);
  const result=await getTransactionBankOrigin(db,7);
  assert.equal(result.status,"merged");
  assert.equal(result.description,"Débito: OXXO PISCINAS");
  assert.equal(sql.prepare("SELECT title FROM transactions WHERE id=7").get().title,"Oxxo");
  assert.equal(sql.prepare("SELECT notes FROM transactions WHERE id=7").get().notes,"Minha anotação pessoal");
  assert.equal(visibleTransactionNotes("Minha anotação pessoal"),"Minha anotação pessoal");
  assert.equal(visibleTransactionNotes("mototrack:nubank-account:secret"),null);
  assert.equal(await getTransactionBankOrigin(db,999),null);
});
