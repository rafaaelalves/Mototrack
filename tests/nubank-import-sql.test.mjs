import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../src/db/migrations.ts";
import { parseNubankAccountCsv } from "../src/domain/nubankCsv.ts";
import {
  stageNubankRowsCore, listBankImportItemsCore, countPendingCore,
  reviewBankItemCore, undoBankReviewCore,
} from "../src/db/nubankImportCore.ts";

const uuid = (n) => String(n).padStart(8, "0") + "-1111-4111-8111-111111111111";
const header = "Data,Valor,Identificador,Descrição\n";
const debit = (id, amount, label, date = "01/11/2026") =>
  date + ",-" + amount + "," + uuid(id) + ",Compra no débito - " + label + "\n";
const pix = (id, amount, label) =>
  "01/11/2026," + amount + "," + uuid(id) + ",Transferência recebida pelo Pix - " + label + " - BANCO FICTÍCIO\n";

async function atomic(sqlite, run) {
  sqlite.exec("BEGIN;");
  try { const result = await run(); sqlite.exec("COMMIT;"); return result; }
  catch (error) { sqlite.exec("ROLLBACK;"); throw error; }
}
function setup(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    execAsync: async (sql) => { sqlite.exec(sql); },
    getFirstAsync: async (sql, values = []) => sqlite.prepare(sql).get(...values) ?? null,
    getAllAsync: async (sql, values = []) => sqlite.prepare(sql).all(...values),
    runAsync: async (sql, values = []) => {
      const r = sqlite.prepare(sql).run(...values);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    withTransactionAsync: async (fn) => atomic(sqlite, fn),
  };
  return { sqlite, db };
}
const countActive = (sqlite) =>
  sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE deletedAt IS NULL;").get().n;

test("importar arquivo deixa lançamentos pendentes, sem mudar o dashboard", async (t) => {
  const { sqlite, db } = setup(t);
  await migrateDatabase(db);
  const rows = parseNubankAccountCsv(header + debit(1,"25.10","OXXO") + pix(2,"119.00","EMPRESA FICTÍCIA"));
  const first = await atomic(sqlite, () => stageNubankRowsCore(db,rows));
  assert.deepEqual(first, { created: 2, repeated: 0 });
  assert.equal(countActive(sqlite), 0);
  assert.equal(await countPendingCore(db), 2);
  const second = await atomic(sqlite, () => stageNubankRowsCore(db, rows));
  assert.deepEqual(second, { created: 0, repeated: 2 });
  assert.equal(await countPendingCore(db), 2);
});

test("repetir UUID com valor diferente interrompe arquivo e reverte tudo", async (t) => {
  const { sqlite, db } = setup(t);
  await migrateDatabase(db);
  await atomic(sqlite, () => stageNubankRowsCore(db,parseNubankAccountCsv(header + debit(1,"25.10","OXXO"))));
  const changed = parseNubankAccountCsv(header +
    debit(3,"99.90","LOJA FICTÍCIA") + debit(1,"27.10","OXXO"));
  await assert.rejects(
    () => atomic(sqlite, () => stageNubankRowsCore(db, changed)),
    /Conflito/,
  );
  assert.equal(await countPendingCore(db), 1);
});

test("revisão aplica a mesma decisão somente ao estabelecimento exato", async (t) => {
  const { sqlite, db } = setup(t);
  await migrateDatabase(db);
  const rows = parseNubankAccountCsv(header + debit(1,"20.00","OXXO") +
    debit(2,"15.00","OXXO") + debit(3,"15.00","OUTRA LOJA"));
  await atomic(sqlite, () => stageNubankRowsCore(db,rows));
  const item = (await listBankImportItemsCore(db)).find(x=>x.description.includes("OXXO"));
  const result = await atomic(sqlite, () => reviewBankItemCore(db, {
    itemId:item.id, action:"import", category:"food", applyToSimilar:true, rememberRule:true,
  }));
  assert.equal(result.reviewed,2);
  assert.equal(result.rowIds.length,2);
  assert.equal(countActive(sqlite),2);
  assert.equal(await countPendingCore(db),1);
  const pending = await listBankImportItemsCore(db);
  assert.match(pending[0].description,/OUTRA LOJA/);

  const other = parseNubankAccountCsv(header + debit(4,"30.00","OXXO"));
  await atomic(sqlite,()=>stageNubankRowsCore(db,other));
  const suggested = (await listBankImportItemsCore(db)).find(x=>x.sourceId===uuid(4));
  assert.equal(suggested.ruleAction,"import");
  assert.equal(suggested.ruleCategory,"food");
  // regra sugere, mas NÃO lança automaticamente
  assert.equal(countActive(sqlite),2);
});

test("não converte Pix recebido automaticamente em delivery ou salário", async (t) => {
  const { sqlite,db }=setup(t);
  await migrateDatabase(db);
  await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(header+pix(1,"119.00","FICTÍCIA"))));
  const item=(await listBankImportItemsCore(db))[0];
  assert.equal(item.suggestedCategory,null);
  await assert.rejects(
    ()=>atomic(sqlite,()=>reviewBankItemCore(db, {
      itemId:item.id,action:"import",category:null,applyToSimilar:false,rememberRule:false,
    })), /Escolha uma categoria/,
  );
  assert.equal(await countPendingCore(db),1);
  assert.equal(countActive(sqlite),0);
});

test("transferência e ignorado não viram despesa ou receita", async (t) => {
  const { sqlite, db }=setup(t);
  await migrateDatabase(db);
  await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(header +
    "01/11/2026,-200.00,"+uuid(1)+",Pagamento de fatura\n"+
    debit(2,"30.00","TESTE"))));
  for(const [row,action] of (await listBankImportItemsCore(db)).map(x=>[x,x.merchantKey==="CARD_BILL"?"transfer":"ignore"])) {
    await atomic(sqlite,()=>reviewBankItemCore(db,{
      itemId:row.id, action,category:null,applyToSimilar:false,rememberRule:false,
    }));
  }
  assert.equal(countActive(sqlite),0);
  assert.equal(await countPendingCore(db),0);
});

test("revisão pode ser desfeita sem hard delete e restaurar pendência", async (t) => {
  const { sqlite, db }=setup(t);
  await migrateDatabase(db);
  await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(header + debit(1,"33.00","OXXO"))));
  const item=(await listBankImportItemsCore(db))[0];
  const res=await atomic(sqlite,()=>reviewBankItemCore(db,{
    itemId:item.id,action:"import",category:"food",applyToSimilar:false,rememberRule:false,
  }));
  assert.equal(countActive(sqlite),1);
  await atomic(sqlite,()=>undoBankReviewCore(db,res.rowIds[0]));
  assert.equal(countActive(sqlite),0);
  assert.equal(await countPendingCore(db),1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM transactions;").get().n,1);
});

test("após edição manual não desfaz uma importação apagando alterações do usuário", async (t) => {
  const {sqlite,db}=setup(t);
  await migrateDatabase(db);
  await atomic(sqlite,()=>stageNubankRowsCore(db,parseNubankAccountCsv(header + debit(1,"33.00","OXXO"))));
  const item=(await listBankImportItemsCore(db))[0];
  const res=await atomic(sqlite,()=>reviewBankItemCore(db,{
    itemId:item.id,action:"import",category:"food",applyToSimilar:false,rememberRule:false,
  }));
  sqlite.exec("UPDATE transactions SET updatedAt = createdAt + 100 WHERE id=1;");
  await assert.rejects(
    ()=>atomic(sqlite,()=>undoBankReviewCore(db,res.rowIds[0])),
    /editado depois/,
  );
  assert.equal(countActive(sqlite),1);
});

test("backup v1 pode recuperar ID de importação pela nota sem duplicar receitas", async (t) => {
  const { sqlite, db } = setup(t);
  await migrateDatabase(db);
  const sample = parseNubankAccountCsv(header + pix(5, "119.00", "FICTÍCIA"));
  await atomic(sqlite, () => stageNubankRowsCore(db, sample));
  const pending = (await listBankImportItemsCore(db))[0];
  await atomic(sqlite, () => reviewBankItemCore(db, {
    itemId: pending.id, action: "import", category: "delivery",
    applyToSimilar: false, rememberRule: false,
  }));
  assert.equal(countActive(sqlite), 1);
  const note = sqlite.prepare("SELECT notes FROM transactions;").get().notes;
  assert.equal(note, "mototrack:nubank-account:" + uuid(5));

  // Simula versão v1 do backup: transações preservadas, fila de importação ausente.
  sqlite.exec("DELETE FROM bank_import_rows;");
  const stage = await atomic(sqlite, () => stageNubankRowsCore(db, sample));
  assert.deepEqual(stage, { created: 0, repeated: 1 });
  assert.equal(await countPendingCore(db), 0);
  assert.equal(countActive(sqlite), 1);
});
