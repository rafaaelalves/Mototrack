import { AppBackground } from "@/src/ui/AppBackground";
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
} from "@expo-google-fonts/nunito";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { SQLiteProvider, type SQLiteDatabase } from "expo-sqlite";
import { useEffect } from "react";
import { Text, TextInput } from "react-native";
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
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deletedAt INTEGER,
      notes TEXT,
      category TEXT,
      distanceMeters INTEGER
    );
  `);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });

  // Quando as fontes carregarem, define padrão global para Text/TextInput
  useEffect(() => {
    if (!fontsLoaded) return;

    const baseTextStyle = {
      fontFamily: "Nunito_400Regular",
      color: "rgba(255,255,255,0.90)",
    };

    // Cast pra "any" só na hora de mexer em defaultProps
    const TextAny = Text as any;
    const TextInputAny = TextInput as any;

    if (!TextAny.defaultProps) TextAny.defaultProps = {};
    TextAny.defaultProps.style = [TextAny.defaultProps.style, baseTextStyle];

    if (!TextInputAny.defaultProps) TextInputAny.defaultProps = {};
    TextInputAny.defaultProps.style = [
      TextInputAny.defaultProps.style,
      {
        fontFamily: "Nunito_400Regular",
        color: "#000",
      },
    ];
  }, [fontsLoaded]);

  // evita flicker com fonte errada
  if (!fontsLoaded) {
    return null;
  }

  return (
    <>
      <AppBackground />
      <SafeAreaProvider>
        <SQLiteProvider databaseName="painel_v2.db" onInit={initDB}>
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          >
            <Stack.Screen
              name="index"
              options={{
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen
              name="newEntry"
              options={{
                presentation: "transparentModal",
                headerShown: false,
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen
              name="stats"
              options={{
                presentation: "transparentModal",
                headerShown: false,
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen
              name="transaction/[id]"
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
    </>
  );
}
