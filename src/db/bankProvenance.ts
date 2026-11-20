import type { SQLiteDatabase } from "expo-sqlite";

export type BankOrigin = {
  source: string;
  description: string;
  dateISO: string;
  status: "imported" | "merged";
};

/**
 * Metadados somente-leitura; nunca expor o identificador do banco como
 * campo de observação manual nem alterar a transação ao conciliar.
 */
export async function getTransactionBankOrigin(
  db: Pick<SQLiteDatabase, "getFirstAsync">,
  transactionId: number,
): Promise<BankOrigin | null> {
  if (!Number.isSafeInteger(transactionId) || transactionId < 1) return null;
  return db.getFirstAsync<BankOrigin>(
    "SELECT source, description, dateISO, status FROM bank_import_rows " +
    "WHERE source='nubank-account' AND transactionId=? " +
    "AND status IN ('imported','merged') ORDER BY updatedAt DESC,id DESC LIMIT 1;",
    [transactionId],
  );
}

/** Compatibilidade de backups antigos: não exibir metadados técnicos como notas. */
export function visibleTransactionNotes(notes: string | null): string | null {
  if (notes?.startsWith("mototrack:nubank-account:")) return null;
  return notes;
}
