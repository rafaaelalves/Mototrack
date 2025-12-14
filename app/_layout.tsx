import { Stack } from "expo-router";
import { SQLiteProvider, type SQLiteDatabase } from "expo-sqlite";
import { SafeAreaProvider } from "react-native-safe-area-context";

async function initDB(db: SQLiteDatabase) {
  // Habilita o WAL (Write-Ahead Logging) para melhor performance e segurança
  await db.execAsync(`PRAGMA journal_mode = WAL;`);
  // Cria a tabela de transações se não existir
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY NOT NULL,
      dateISO TEXT NOT NULL,
      type TEXT NOT NULL, -- 'income' ou 'expense'
      amountCents INTEGER NOT NULL,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;"
  );
  const version = row?.user_version ?? 0;

  // v2 adiciona notes
  if (version < 2) {
    await db.execAsync(`ALTER TABLE transactions ADD COLUMN notes TEXT;`);
    await db.execAsync(`PRAGMA user_version = 2;`);
  }
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="painel.db" onInit={initDB}>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen
            name="newEntry"
            options={{
              presentation: "transparentModal",
              headerShown: false,
              animation: "fade",
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
        </Stack>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
