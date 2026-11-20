import { Platform } from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import type { NubankAccountRow } from "../domain/nubankCsv";
import {
  countPendingCore, listBankImportItemsCore,
  getExistingTransactionMatchesCore, saveBankImportDraftCore,
  listImportBatchesCore, listImportBatchEventsCore,
  cancelPendingBatchCore, getPendingCategoryGroupCore,
  categorizePendingGroupCore, getLearnedCategoryCore,
  reviewBankItemCore, stageNubankRowsCore, undoBankReviewCore,
  analyzeSmartBatchCore, createReadyPreview, approveReadyBatchCore,
  mergeExistingBankRowCore, skipBankRowCore, rememberCategoryGroupCore,
  listMergedBankRowsCore, unmergeBankRowCore,
  listExcludedBankRowsCore, reopenExcludedBankRowCore,
  type GroupScope, type ReviewDecision, type SmartReadyPreview, type SkipReason,
} from "./nubankImportCore";
import {
  previewBankBatchReversalCore, reverseBankBatchCore,
  type BatchReversalPreview,
} from "./bankBatchRollback";

/** No dispositivo, isolamento exclusivo; no navegador, transação comum. */
async function atomic<T>(
  db: SQLiteDatabase,
  work: (tx: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  if (Platform.OS !== "web") {
    let value!: T;
    await db.withExclusiveTransactionAsync(async (tx) => {
      value = await work(tx);
    });
    return value;
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

export const NUBANK_REVIEW_PAGE_SIZE = 50;

export async function getNubankReviewQueue(
  db: SQLiteDatabase,
  requestedOffset = 0,
) {
  const pending = await countPendingCore(db);
  const offset = Math.min(
    Math.max(0, requestedOffset),
    pending === 0 ? 0 : Math.floor((pending - 1) / NUBANK_REVIEW_PAGE_SIZE) * NUBANK_REVIEW_PAGE_SIZE,
  );
  const items = await listBankImportItemsCore(
    db, "pending", NUBANK_REVIEW_PAGE_SIZE, offset,
  );
  return { items, pending, offset, pageSize: NUBANK_REVIEW_PAGE_SIZE };
}

export function getNubankPossibleDuplicates(db: SQLiteDatabase, itemId: number) {
  return getExistingTransactionMatchesCore(db, itemId);
}

export function saveNubankPendingCategory(
  db: SQLiteDatabase,
  itemId: number,
  category: string | null,
) {
  return saveBankImportDraftCore(db, itemId, category);
}

export function reviewNubankImport(db: SQLiteDatabase, decision: ReviewDecision) {
  return atomic(db, (tx) => reviewBankItemCore(tx, decision));
}

export function undoNubankImport(db: SQLiteDatabase, rowIds: number[]) {
  return atomic(db, async (tx) => {
    for (const rowId of rowIds) await undoBankReviewCore(tx, rowId);
  });
}

export function getNubankImportBatches(db: SQLiteDatabase) {
  return listImportBatchesCore(db);
}

export function cancelNubankPendingBatch(db: SQLiteDatabase, createdAt: number) {
  return atomic(db, (tx) => cancelPendingBatchCore(tx, createdAt));
}

export function getNubankCategoryGroup(
  db: SQLiteDatabase,
  rowId: number,
  scope: GroupScope,
) {
  return getPendingCategoryGroupCore(db, rowId, scope);
}

export function categorizeNubankPendingGroup(
  db: SQLiteDatabase,
  rowId: number,
  category: string,
  scope: GroupScope,
) {
  return atomic(db, (tx) => categorizePendingGroupCore(tx, rowId, category, scope));
}

export function getNubankLearnedCategory(
  db: SQLiteDatabase,
  merchantKey: string,
  type: "income" | "expense",
) {
  return getLearnedCategoryCore(db, merchantKey, type);
}

export function getNubankBatchEvents(db: SQLiteDatabase, createdAt: number) {
  return listImportBatchEventsCore(db, createdAt);
}
export function previewNubankBatchReversal(db: SQLiteDatabase, createdAt: number) {
  return previewBankBatchReversalCore(db, createdAt);
}
export function reverseNubankBatch(db: SQLiteDatabase, preview: BatchReversalPreview) {
  return atomic(db, tx => reverseBankBatchCore(tx, preview));
}

export function analyzeNubankBatch(db: SQLiteDatabase, createdAt: number) {
  return analyzeSmartBatchCore(db, createdAt);
}

export function previewNubankReady(analysis: Awaited<ReturnType<typeof analyzeSmartBatchCore>>) {
  return createReadyPreview(analysis);
}

export function approveNubankReady(db: SQLiteDatabase, preview: SmartReadyPreview) {
  return atomic(db, tx => approveReadyBatchCore(tx, preview));
}

export function mergeNubankWithExisting(db: SQLiteDatabase, rowId: number, transactionId: number) {
  return atomic(db, tx => mergeExistingBankRowCore(tx, rowId, transactionId));
}

export function excludeNubankRow(db: SQLiteDatabase, rowId: number, reason: SkipReason) {
  return atomic(db, tx => skipBankRowCore(tx, rowId, reason));
}

export function rememberNubankCategoryGroup(
  db: SQLiteDatabase,
  rowId: number,
  category: string,
  scope: GroupScope,
) {
  return atomic(db, tx => rememberCategoryGroupCore(tx, rowId, category, scope));
}

export function getNubankMergedRows(db:SQLiteDatabase,createdAt:number){
  return listMergedBankRowsCore(db,createdAt);
}
export function unmergeNubankRow(db:SQLiteDatabase,rowId:number){
  return atomic(db,tx=>unmergeBankRowCore(tx,rowId));
}

export function getNubankExcludedRows(db:SQLiteDatabase,createdAt:number){
  return listExcludedBankRowsCore(db,createdAt);
}
export function reopenNubankExcludedRow(db:SQLiteDatabase,rowId:number){
  return atomic(db,tx=>reopenExcludedBankRowCore(tx,rowId));
}
