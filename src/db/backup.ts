import { Platform } from "react-native";
import {
  parseBackupFile, type BackupFile,
  type BankImportBackupRow, type BankImportRuleBackup,
} from "@/src/domain/backupValidation";
import type { Transaction } from "@/src/domain/transaction";
import type { SQLiteDatabase } from "expo-sqlite";
import { replaceTransactions } from "./restoreCore";

export type { BackupFile } from "@/src/domain/backupValidation";

// Inclui lançamentos excluídos logicamente para preservar o banco completo.
export async function buildBackup(db: SQLiteDatabase): Promise<BackupFile> {
  const rows = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions ORDER BY dateISO DESC, createdAt DESC;`,
  );

  const bankImportRows = await db.getAllAsync<BankImportBackupRow>(
    "SELECT * FROM bank_import_rows ORDER BY id;",
  );
  const bankImportRules = await db.getAllAsync<BankImportRuleBackup>(
    "SELECT * FROM bank_import_rules ORDER BY id;",
  );

  return parseBackupFile({
    version: 2,
    exportedAt: Date.now(),
    transactions: rows,
    bankImportRows,
    bankImportRules,
  });
}

/**
 * Restauração atômica: se algum INSERT falhar, o DELETE é revertido.
 * No Android/iOS, transação exclusiva impede que consultas externas
 * entrem acidentalmente na transação da restauração.
 *
 * O backup de recuperação pré-restauração é criado pela camada de serviço
 * ANTES de invocar esta função. Nunca usar diretamente pela UI.
 */
export async function applyBackup(
  db: SQLiteDatabase,
  input: unknown,
): Promise<void> {
  const data = parseBackupFile(input);

  if (Platform.OS === "web") {
    // Expo SQLite não oferece withExclusiveTransactionAsync no navegador.
    await db.withTransactionAsync(async () => {
      await replaceTransactions(db, data);
    });
    return;
  }

  await db.withExclusiveTransactionAsync(async (tx) => {
    await replaceTransactions(tx, data);
  });
}
