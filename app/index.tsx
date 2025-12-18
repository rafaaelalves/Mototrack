import { listTransactionsByMonth, Transaction } from "@/src/db/transactions";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  CaretLeftIcon,
  CaretRightIcon,
  ChartBarIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  PlusIcon,
} from "phosphor-react-native";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

function formatBRL(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatDay(iso: string) {
  // Espera yyyy-mm-dd
  const parts = iso.split("-");
  return parts[2] ?? iso;
}

// label de hora usando createdAt.
// function formatTimeFromCreatedAt(ms: number) {
//   return new Date(ms).toLocaleTimeString("pt-BR", {
//     hour: "2-digit",
//     minute: "2-digit",
//   });
// }

export default function Index() {
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const db = useSQLiteContext();

  const Separator = () => <View style={styles.separator} />;

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
            <CaretLeftIcon weight="duotone" color="rgba(255,255,255,0.70)" />
          </Pressable>

          <Pressable
            onPress={() =>
              router.push({
                pathname: "/stats",
                params: {
                  year: String(selectedYear),
                  month: String(selectedMonth),
                },
              })
            }
            style={{ padding: 10 }}
          >
            <View style={styles.stats}>
              <ChartBarIcon
                size={20}
                weight="duotone"
                color="rgba(255,255,255,0.70)"
              />

              <Text style={styles.monthTitle}>{monthLabel}</Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => handleMonthChange(1)}
            style={styles.monthButton}
            disabled={isCurrentMonth}
          >
            <CaretRightIcon
              weight="duotone"
              color="rgba(255,255,255,0.70)"
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
                pathname: "/transaction/[id]",
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

              <View style={styles.dayCol}>
                <Text style={styles.dayText}>Dia</Text>
                <Text style={styles.dayNumber}>{formatDay(item.dateISO)}</Text>
              </View>

              <View style={styles.transactionContent}>
                <View style={styles.transactionHeader}>
                  <Text style={styles.titleText} numberOfLines={1}>
                    {item.title}
                  </Text>

                  <Text
                    style={[
                      styles.amountText,
                      item.type === "income"
                        ? styles.ammountIncome
                        : styles.amountExpense,
                    ]}
                  >
                    {item.type === "income" ? "+" : "-"}
                    R$ {formatBRL(item.amountCents)}
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Sem lançamentos neste mês</Text>
            <Text style={styles.emptySubtitle}>
              Toque no botão + para registrar a sua primeira entrada ou saída.
            </Text>
          </View>
        }
        ItemSeparatorComponent={Separator}
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
    color: "rgba(255,255,255,0.70)",
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    color: "rgba(255,255,255,0.70)",
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 6,
    color: "rgba(255,255,255,0.70)",
  },
  summaryNumber: {
    fontSize: 16,
    fontWeight: "600",
    color: "rgba(255,255,255,0.70)",
  },
  transactionList: {
    paddingBottom: 20,
  },
  transactionItemList: {
    padding: 15,
    backgroundColor: "rgba(255,255,255,0.06)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  add: {
    position: "absolute",
    bottom: 30,
    right: 30,
    backgroundColor: "rgba(255,255,255,0.15)",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4, //Android
    shadowOpacity: 0.2, //IOS
    shadowOffset: { width: 0, height: 3 }, //IOS
  },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dayCol: {
    width: 42,
    alignItems: "center",
  },
  dayText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
  },
  dayNumber: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.95)",
  },
  rightCol: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 6,
    marginLeft: 10,
  },
  transactionContent: {
    flex: 1,
  },
  transactionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titleText: {
    flex: 1,
    color: "rgba(255,255,255,0.95)",
    fontWeight: "700",
  },
  amountText: {
    fontSize: 15,
    fontWeight: "700",
  },
  ammountIncome: {
    color: "#28a745",
  },
  amountExpense: {
    color: "#ff3b30",
  },
  emptyContainer: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.90)",
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: "center",
    color: "rgba(255,255,255,0.65)",
  },
  separator: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.30)",
    marginLeft: 25,
    marginRight: 25,
    opacity: 0.7,
  },
});
