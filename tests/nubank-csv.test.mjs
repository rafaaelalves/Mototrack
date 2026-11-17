import assert from "node:assert/strict";
import test from "node:test";
import { parseNubankAccountCsv, parseCsvRecords } from "../src/domain/nubankCsv.ts";

const header = "Data,Valor,Identificador,Descrição\n";
const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const id3 = "33333333-3333-4333-8333-333333333333";
const example = () => header +
  "01/11/2026,-61.75," + id1 + ",Transferência enviada pelo Pix - POSTO EXEMPLO - 12.345.678/0001-90 - BANCO A\n" +
  "02/11/2026,119.00," + id2 + ",Transferência recebida pelo Pix - LOJA FICTÍCIA - 11.222.333/0001-44 - BANCO B\n" +
  "03/11/2026,-39.90," + id3 + ",Compra no débito - OXXO\n";

test("interpreta sinais, datas e centavos exatos do extrato da conta", () => {
  const rows = parseNubankAccountCsv(example());
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => [r.dateISO, r.type, r.amountCents]),
    [["2026-11-01","expense",6175],["2026-11-02","income",11900],["2026-11-03","expense",3990]],
  );
  assert.equal(rows[0].sourceId, id1);
  assert.equal(rows[2].suggestedCategory, "food");
  assert.equal(rows[1].suggestedCategory, null);
  assert.equal(rows[1].suggestedAction, null);
});

test("remove dados de conta e CNPJ da descrição apresentada", () => {
  const rows = parseNubankAccountCsv(example());
  assert.equal(rows[0].description.includes("12.345.678/0001-90"), false);
  assert.equal(rows[0].description.includes("Agência:"), false);
  assert.equal(rows[0].merchantKey, "PIX_OUT:POSTO EXEMPLO");
});

test("reconhece fatura como sugestão de transferência, mas não a aprova", () => {
  const row = parseNubankAccountCsv(header +
    "08/11/2026,-350.00," + id1 + ",Pagamento de fatura\n")[0];
  assert.equal(row.suggestedAction, "transfer");
  assert.equal(row.merchantKey, "CARD_BILL");
});

test("lê vírgulas, aspas escapadas, quebras em campos e BOM", () => {
  const text = "\uFEFF" + header +
    '09/11/2026,-20.00,' + id1 + ',"Compra no débito - Mercado ""Bom Dia"", unidade A"\r\n' +
    '10/11/2026,15.00,' + id2 + ',"Transferência recebida pelo Pix - Oficina\nABC - BANCO"\r\n';
  const rows = parseNubankAccountCsv(text);
  assert.equal(rows.length, 2);
  assert.match(rows[0].description, /"Bom Dia"/);
  assert.match(rows[1].description, /Oficina ABC/);
  assert.equal(parseCsvRecords(text).length, 3);
});

test("é idempotente no mesmo arquivo se o Identificador se repetir igual", () => {
  const line = "01/11/2026,-61.75," + id1 + ",Compra no débito - EXEMPLO\n";
  const rows = parseNubankAccountCsv(header + line + line);
  assert.equal(rows.length, 1);
});

test("bloqueia UUID repetido com outros valores", () => {
  const csv = header +
    "01/11/2026,-61.75," + id1 + ",Compra no débito - EXEMPLO\n" +
    "01/11/2026,-62.75," + id1 + ",Compra no débito - EXEMPLO\n";
  assert.throws(() => parseNubankAccountCsv(csv), /repetido com dados diferentes/);
});

test("rejeita formatos de fatura e cabeçalhos incompletos", () => {
  assert.throws(
    () => parseNubankAccountCsv('date,title,amount\n2026-10-10,COMPRA,"19,90"\n'),
    /CSV é da fatura/,
  );
  assert.throws(
    () => parseNubankAccountCsv("Data,Valor,Descrição\n01/11/2026,-1.00,A\n"),
    /Formato inválido/,
  );
});

test("rejeita datas impossíveis, dinheiro inválido e zero", () => {
  const line = (date, value) => header + date + "," + value + "," + id1 + ",Compra no débito - TESTE\n";
  assert.throws(() => parseNubankAccountCsv(line("31/02/2026","-10.00")), /Data inexistente/);
  assert.throws(() => parseNubankAccountCsv(line("01/11/2026","-12,50")), /Colunas incorretas/);
  assert.throws(() => parseNubankAccountCsv(line("01/11/2026","0.00")), /zero/);
  assert.throws(() => parseNubankAccountCsv(line("01/11/2026","-1.999")), /Valor inválido/);
});

test("falha se CSV tiver aspas sem fechar ou linha com colunas faltando", () => {
  assert.throws(() => parseNubankAccountCsv(header + '01/11/2026,-5.00,' + id1 + ',"teste\n'), /não fechadas/);
  assert.throws(() => parseNubankAccountCsv(header + "01/11/2026,-5.00," + id1 + "\n"), /Colunas incorretas/);
});

test("não adivinha que Pix recebido é salário ou entrega", () => {
  const rows = parseNubankAccountCsv(example());
  assert.equal(rows[1].type, "income");
  assert.equal(rows[1].suggestedCategory, null);
});
