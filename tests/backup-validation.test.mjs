import assert from "node:assert/strict";
import test from "node:test";
import { parseBackupFile } from "../src/domain/backupValidation.ts";

const example = () => ({
  version: 1,
  exportedAt: 1_700_000_000_000,
  transactions: [
    {
      id: 1,
      dateISO: "2026-11-15",
      type: "income",
      amountCents: 11900,
      title: "Turno fictício",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
      deletedAt: null,
      notes: null,
      category: "delivery",
      distanceMeters: 120000,
    },
  ],
});

test("aceita backup válido e preserva centavos, categoria, metros e IDs", () => {
  const result = parseBackupFile(example());
  assert.equal(result.version, 1);
  assert.equal(result.transactions[0].amountCents, 11900);
  assert.equal(result.transactions[0].distanceMeters, 120000);
  assert.equal(result.transactions[0].category, "delivery");
  assert.equal(result.transactions[0].id, 1);
});

test("normaliza backup v1 antigo, sem campos opcionais", () => {
  const input = example();
  delete input.transactions[0].updatedAt;
  delete input.transactions[0].deletedAt;
  delete input.transactions[0].notes;
  delete input.transactions[0].category;
  delete input.transactions[0].distanceMeters;
  const result = parseBackupFile(input);
  assert.equal(result.transactions[0].updatedAt, input.transactions[0].createdAt);
  assert.equal(result.transactions[0].deletedAt, null);
  assert.equal(result.transactions[0].notes, null);
  assert.equal(result.transactions[0].category, null);
  assert.equal(result.transactions[0].distanceMeters, null);
});

test("preserva lançamentos excluídos logicamente", () => {
  const input = example();
  input.transactions[0].deletedAt = 1_700_000_000_200;
  const result = parseBackupFile(input);
  assert.equal(result.transactions[0].deletedAt, 1_700_000_000_200);
});

test("rejeita versão desconhecida, inclusive superior", () => {
  assert.throws(
    () => parseBackupFile({ ...example(), version: 5 }),
    /Versão de backup incompatível/,
  );
});

test("rejeita arquivo sem transações ou sem metadados necessários", () => {
  assert.throws(
    () => parseBackupFile({ version: 1, exportedAt: 10 }),
    /lista de lançamentos/,
  );
  assert.throws(
    () => parseBackupFile({ ...example(), exportedAt: "ontem" }),
    /Data de exportação/,
  );
});

test("rejeita linhas não-objeto e valores inválidos", () => {
  assert.throws(
    () => parseBackupFile({ ...example(), transactions: [null] }),
    /precisa ser um objeto/,
  );
  const input = example();
  input.transactions[0].amountCents = -1;
  assert.throws(() => parseBackupFile(input), /valor/);
  input.transactions[0].amountCents = 12.5;
  assert.throws(() => parseBackupFile(input), /inteiro/);
});

test("rejeita datas impossíveis, tipo e categoria incompatíveis", () => {
  const input = example();
  input.transactions[0].dateISO = "2026-02-30";
  assert.throws(() => parseBackupFile(input), /data inválida/);
  input.transactions[0].dateISO = "2026-02-28";
  input.transactions[0].category = "fuel";
  assert.throws(() => parseBackupFile(input), /categoria não reconhecida/);
  input.transactions[0].type = "invalid";
  assert.throws(() => parseBackupFile(input), /tipo de lançamento/);
});

test("rejeita IDs repetidos antes da restauração", () => {
  const input = example();
  input.transactions.push({ ...input.transactions[0] });
  assert.throws(() => parseBackupFile(input), /IDs de lançamento repetidos/);
});

test("rejeita distâncias negativas e IDs não seguros", () => {
  const input = example();
  input.transactions[0].distanceMeters = -50;
  assert.throws(() => parseBackupFile(input), /distância/);
  input.transactions[0].distanceMeters = null;
  input.transactions[0].id = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => parseBackupFile(input), /id/);
});

test("retorna objetos novos e não modifica os dados de entrada", () => {
  const input = example();
  const parsed = parseBackupFile(input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.transactions[0], input.transactions[0]);
  assert.deepEqual(parsed.transactions[0], input.transactions[0]);
});

test("backup vazio é formato válido, mas restauração sobre banco preenchido é proibida", () => {
  const parsed = parseBackupFile({ version: 1, exportedAt: 1, transactions: [] });
  assert.deepEqual(parsed.transactions, []);
  // O bloqueio sobre banco preenchido é testado no fluxo SQLite/QA Android.
});
