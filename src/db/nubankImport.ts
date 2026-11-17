import { Platform } from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import type { NubankAccountRow } from "../domain/nubankCsv";
import {
  countPendingCore, listBankImportItemsCore,
  reviewBankItemCore, stageNubankRowsCore, undoBankReviewCore,
  type ReviewDecision,
} from "./nubankImportCore";

/** No dispositivo, isolamento exclusivo; no navegador, transação comum. */
async function atomic<T>(
  db: SQLiteDatabase,
  work: (tx: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  if (Platform.OS !== "web") {
    return db.withExclusiveTransactionAsync(work);
  }
  // As APIs de transação exclusiva não existem em Expo SQLite Web.
  let value!: T;
  await db.withTransactionAsync(async () => { value = await work(db); });
  return value;
}

export async function stageNubankImport(db: SQLiteDatabase, rows: NubankAccountRow[]) {
  if (!rows.length) throw new Error("Extrato sem lançamentos.");
  const result = await atomic(db, (tx) => stageNubankRowsCore(tx, rows));
  const pending = await countPendingCore(db);
  return { ...result, pending };
}

export async function getNubankReviewQueue(db: SQLiteDatabase) {
  const [items, pending] = await Promise.all([
    listBankImportItemsCore(db, "pending", 100),
    countPendingCore(db),
  ]);
  return { items, pending };
}

export function reviewNubankImport(db: SQLiteDatabase, decision: ReviewDecision) {
  return atomic(db, (tx) => reviewBankItemCore(tx, decision));
}

export function undoNubankImport(db: SQLiteDatabase, rowId: number) {
  return atomic(db, (tx) => undoBankReviewCore(tx, rowId));
}
