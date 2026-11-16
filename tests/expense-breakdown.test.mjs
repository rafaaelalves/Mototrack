import assert from "node:assert/strict";
import test from "node:test";
import { buildExpenseBreakdown } from "../src/domain/expenseBreakdown.ts";

const rows = [
  { key: "fuel", label: "Combustível", value: 12000 },
  { key: "food", label: "Alimentação", value: 9500 },
  { key: "maintenance", label: "Manutenção", value: 8000 },
  { key: "vehicle", label: "Veículo", value: 3000 },
  { key: "other", label: "Outros", value: 2000 },
  { key: "uncategorized", label: "Sem categoria", value: 1500 },
];

test("não oculta despesas ao limitar o donut a quatro setores", () => {
  const result = buildExpenseBreakdown(rows, 4);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(x => x.key), [
    "fuel", "food", "maintenance", "remaining-categories",
  ]);
  assert.equal(result[3].value, 6500);
  assert.equal(
    result.reduce((total, row) => total + row.value, 0),
    rows.reduce((total, row) => total + row.value, 0),
  );
});

test("mantém as categorias individuais quando há espaço", () => {
  const result = buildExpenseBreakdown(rows.slice(0, 3), 4);
  assert.deepEqual(result.map(x => x.key), ["fuel", "food", "maintenance"]);
});

test("não mostra categorias sem gastos e trata lista vazia", () => {
  assert.deepEqual(buildExpenseBreakdown([], 4), []);
  assert.deepEqual(buildExpenseBreakdown([
    { key: "fuel", label: "Combustível", value: 0 },
    { key: "food", label: "Alimentação", value: -200 },
  ]), []);
});

test("ordenar setores não modifica a lista original", () => {
  const source = rows.slice().reverse();
  const snapshot = JSON.stringify(source);
  buildExpenseBreakdown(source);
  assert.equal(JSON.stringify(source), snapshot);
});

test("lida com valores empatados de modo determinístico", () => {
  const equal = [
    { key: "z", label: "Z", value: 100 },
    { key: "a", label: "A", value: 100 },
  ];
  assert.deepEqual(buildExpenseBreakdown(equal).map(x => x.key), ["a", "z"]);
});

test("rejeita limite inválido", () => {
  assert.throws(() => buildExpenseBreakdown(rows, 0), /pelo menos dois/);
  assert.throws(() => buildExpenseBreakdown(rows, 2.5), /pelo menos dois/);
});
