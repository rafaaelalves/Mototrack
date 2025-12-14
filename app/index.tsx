import {
  deleteTransaction,
  listTransactionsByMonth,
  Transaction,
} from "@/src/db/transactions";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  CaretLeftIcon,
  CaretRightIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  PlusIcon,
  TrashSimpleIcon,
} from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

function formatBRL(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatDay(iso: string) {
  // Espera yyyy=mm-dd
  const parts = iso.split("-");
  return parts[2] ?? iso;
}

export default function Index() {
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const db = useSQLiteContext();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const incomeCents = transactions.reduce(
    (acc, t) => acc + (t.type === "income" ? t.amountCents : 0),
    0
  );
  const expenseCents = transactions.reduce(
    (acc, t) => acc + (t.type === "expense" ? t.amountCents : 0),
    0
  );
  const totalCents = incomeCents - expenseCents;

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const isCurrentMonth =
    selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;

  const monthLabel = new Date(
    selectedYear,
    selectedMonth - 1,
    1
  ).toLocaleString("pt-BR", { month: "long", year: "numeric" });

  const load = useCallback(async () => {
    const items = await listTransactionsByMonth(
      db,
      selectedYear,
      selectedMonth
    );
    setTransactions(items);
  }, [db, selectedYear, selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  function handleMonthChange(delta: number) {
    let newMonth = selectedMonth + delta;
    let newYear = selectedYear;

    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    } else if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }

    setSelectedMonth(newMonth);
    setSelectedYear(newYear);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.monthRow}>
          <Pressable
            onPress={() => handleMonthChange(-1)}
            style={styles.monthButton}
          >
            <CaretLeftIcon weight="duotone" />
          </Pressable>

          <Text style={styles.monthTitle}>{monthLabel}</Text>

          <Pressable
            onPress={() => handleMonthChange(1)}
            style={styles.monthButton}
            disabled={isCurrentMonth}
          >
            <CaretRightIcon
              weight="duotone"
              style={isCurrentMonth ? { opacity: 0.3 } : undefined}
            />
          </Pressable>
        </View>
        <Text style={styles.summaryTitle}>Resumo do mês</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Entradas</Text>
            <Text style={styles.summaryNumber}>
              R$ {formatBRL(incomeCents)}
            </Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Saídas</Text>
            <Text style={styles.summaryNumber}>
              R$ {formatBRL(expenseCents)}
            </Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Saldo</Text>
            <Text style={styles.summaryNumber}>R$ {formatBRL(totalCents)}</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.transactionList,
          { paddingBottom: 120 + insets.bottom },
        ]}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/newEntry",
                params: { id: String(item.id) },
              })
            }
          >
            <View style={styles.transactionItemList}>
              {item.type === "expense" ? (
                <MinusCircleIcon size={24} weight="duotone" color="#ff3b30" />
              ) : (
                <PlusCircleIcon size={24} weight="duotone" color="#28a745" />
              )}
              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Text>{formatDay(item.dateISO)}</Text>
                  <Text style={{ fontWeight: "600" }}>{item.title}</Text>
                </View>
                <Text>
                  R$ {item.type === "income" ? "+" : "-"}{" "}
                  {formatBRL(item.amountCents)}
                </Text>
              </View>
              {item.notes ? (
                <Text style={{ opacity: 0.7, marginTop: 2 }} numberOfLines={1}>
                  {item.notes}
                </Text>
              ) : null}
              <Pressable
                style={{ padding: 8 }}
                onPress={async () => {
                  Alert.alert(
                    "Excluir lançamento?",
                    "Essa ação não pode ser desfeita.",
                    [
                      { text: "Cancelar", style: "cancel" },
                      {
                        text: "Excluir",
                        style: "destructive",
                        onPress: async () => {
                          await deleteTransaction(db, item.id);
                          load();
                        },
                      },
                    ]
                  );
                }}
              >
                <TrashSimpleIcon
                  size={25}
                  weight="duotone"
                  color="#ff3b30"
                  style={{ opacity: 0.7 }}
                />
              </Pressable>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={{ padding: 20 }}>Sem lançamentos ainda</Text>
        }
      />
      <Pressable
        style={[styles.add, { bottom: 30 + insets.bottom }]}
        onPress={() => router.push("/newEntry")}
      >
        <PlusIcon size={28} weight="bold" color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 10,
  },
  header: {
    padding: 20,
  },
  monthRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  monthButton: {
    padding: 10,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: "bold",
    textTransform: "capitalize",
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 6,
  },
  summaryNumber: {
    fontSize: 16,
    fontWeight: "600",
  },
  transactionList: {
    paddingBottom: 20,
  },
  transactionItemList: {
    padding: 15,
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  add: {
    position: "absolute",
    bottom: 30,
    right: 30,
    backgroundColor: "#007bff",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4, //Android
    shadowOpacity: 0.2, //IOS
    shadowOffset: { width: 0, height: 3 }, //IOS
  },
});
