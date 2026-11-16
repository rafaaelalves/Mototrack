import assert from "node:assert/strict";
import test from "node:test";
import { projectRecordedIncome } from "../src/domain/projectionCore.ts";

const isDelivery = (line) =>
  line.type === "income" && line.category === "delivery";

function calculate(transactions, elapsedDays = 10, daysInMonth = 30) {
  return projectRecordedIncome({
    transactions,
    elapsedDays,
    daysInMonth,
    isRunRateIncome: isDelivery,
  });
}

test("projetar entregas não multiplica salário nem receita única", () => {
  const result = calculate([
    { type: "income", category: "salary", amountCents: 300_000 },
    { type: "income", category: "delivery", amountCents: 11_000 },
    { type: "income", category: "one_off", amountCents: 3_000 },
    { type: "expense", category: "maintenance", amountCents: 50_000 },
  ]);
  assert.equal(result.runRateIncomeCents, 11_000);
  assert.equal(result.nonProjectedIncomeCents, 303_000);
  assert.equal(result.observedIncomeCents, 314_000);
  assert.equal(result.projectedRunRateIncomeCents, 33_000);
  assert.equal(result.projectedIncomeCents, 336_000);
  assert.equal(result.observedExpenseCents, 50_000);
});

test("despesa de uma revisão permanece observada, sem extrapolação", () => {
  const result = calculate([
    { type: "expense", category: "maintenance", amountCents: 35_400 },
    { type: "expense", category: "fuel", amountCents: 15_000 },
  ], 1, 30);
  assert.equal(result.observedExpenseCents, 50_400);
  assert.equal(result.projectedIncomeCents, 0);
  assert.equal("projectedNetCents" in result, false);
  assert.equal("projectedExpenseCents" in result, false);
});

test("mês encerrado tem projeção igual ao realizado", () => {
  const result = calculate([
    { type: "income", category: "delivery", amountCents: 11_000 },
    { type: "income", category: "salary", amountCents: 300_000 },
  ], 30, 30);
  assert.equal(result.projectedRunRateIncomeCents, 11_000);
  assert.equal(result.projectedIncomeCents, 311_000);
});

test("entradas sem categoria permanecem não recorrentes", () => {
  const result = calculate([
    { type: "income", category: null, amountCents: 5000 },
  ]);
  assert.equal(result.nonProjectedIncomeCents, 5000);
  assert.equal(result.projectedRunRateIncomeCents, 0);
});

test("sem turnos registrados não inventa receita futura", () => {
  const result = calculate([]);
  assert.equal(result.projectedRunRateIncomeCents, 0);
  assert.equal(result.observedExpenseCents, 0);
  assert.equal(result.projectedIncomeCents, 0);
});

test("projeção usa dias restantes e mantém valores em centavos", () => {
  const result = calculate([
    { type: "income", category: "delivery", amountCents: 1001 },
  ], 9, 31);
  assert.equal(result.projectedRunRateIncomeCents, 3448);
  assert.equal(result.avgRunRateIncomePerDayCents, 1001 / 9);
});

test("recusa períodos impossíveis e valores monetários inválidos", () => {
  assert.throws(() => calculate([], 0, 30), /período válido/);
  assert.throws(() => calculate([], 30, 29), /período válido/);
  assert.throws(() => calculate([], 10, 32), /período válido/);
  assert.throws(() => calculate([{ type: "income", category: "delivery", amountCents: -1 }]), /centavos/);
  assert.throws(() => calculate([{ type: "income", category: "delivery", amountCents: 12.5 }]), /centavos/);
});
