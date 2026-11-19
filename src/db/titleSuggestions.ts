import type { SQLiteDatabase } from "expo-sqlite";
import type { TransactionType } from "../domain/transaction";

export type TitleSuggestion = {
  title: string;
  category: string;
  occurrences: number;
  lastDateISO: string;
};

type ReadConnection = Pick<SQLiteDatabase, "getAllAsync">;

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/\s+/g," ").trim();
}

/**
 * Autocomplete local: sugere títulos e categorias usados anteriormente.
 * Não cria regras, não altera registros nem infere salário/entregas.
 */
export async function suggestTransactionTitlesCore(
  db: ReadConnection,
  search: string,
  type: TransactionType,
  limit = 6,
): Promise<TitleSuggestion[]> {
  const needle = normalized(search);
  if (needle.length < 2) return [];
  if (!["income","expense"].includes(type) || !Number.isSafeInteger(limit) ||
      limit < 1 || limit > 20) throw new Error("Consulta inválida.");
  const rows = await db.getAllAsync<TitleSuggestion>(
    "SELECT title, category, COUNT(*) AS occurrences, MAX(dateISO) AS lastDateISO " +
    "FROM transactions WHERE deletedAt IS NULL AND type=? " +
    "AND category IS NOT NULL GROUP BY title, category " +
    "ORDER BY occurrences DESC, lastDateISO DESC LIMIT 1500;",
    [type],
  );
  return rows.filter((row) => normalized(row.title).includes(needle))
    .sort((a,b) => {
      const aPrefix = normalized(a.title).startsWith(needle) ? 1 : 0;
      const bPrefix = normalized(b.title).startsWith(needle) ? 1 : 0;
      return bPrefix-aPrefix || b.occurrences-a.occurrences ||
        b.lastDateISO.localeCompare(a.lastDateISO) ||
        a.title.localeCompare(b.title);
    }).slice(0,limit);
}
