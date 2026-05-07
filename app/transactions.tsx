import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  CaretLeftIcon,
  CaretRightIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  PlusIcon,
  XIcon,
} from "phosphor-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { listTransactionsByDateRange } from "@/src/db/transactions";
import { Transaction } from "@/src/domain/transaction";
import { formatBRL, formatDay, monthLabelPT } from "@/src/utils/format";

import {
  CategoryOptions,
  type TransactionCategory,
} from "@/src/domain/categories";

//Mes inteiro
function getMonthRange(year: number, month1to12: number) {
  const mm = String(month1to12).padStart(2, "0");
  const daysInMonth = new Date(year, month1to12, 0).getDate();

  const startISO = `${year}-${mm}-01`;
  const endISO = `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`;
  return { startISO, endISO };
}

type TypeFilter = "all" | "income" | "expense";

type CategoryFilter = "all" | TransactionCategory | "uncategorized";

const categoryFilterOptions: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "Todas" },
  ...CategoryOptions.map((c) => ({ key: c.key, label: c.label })),
  { key: "uncategorized", label: "Sem categoria" },
];

export default function TransactionsScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ year?: string; month?: string }>();

  const Separator = () => <View style={styles.separator} />;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  const now = new Date();
  const parsedYear = Number(params.year);
  const parsedMonth = Number(params.month);
  const initialYear = Number.isFinite(parsedYear) ? parsedYear : now.getFullYear();
  const initialMonth =
    Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth
      : now.getMonth() + 1;

  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  const monthLabel = monthLabelPT({
    year: selectedYear,
    month: selectedMonth,
  });

  const load = useCallback(async () => {
    const { startISO, endISO } = getMonthRange(selectedYear, selectedMonth);
    const items = await listTransactionsByDateRange(db, startISO, endISO);
    setTransactions(items);
  }, [db, selectedYear, selectedMonth]);

  // carrega quando entra e quando muda ano/mês
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
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

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transactions.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;

      if (categoryFilter !== "all") {
        if (t.type !== "expense") return false;

        if (categoryFilter === "uncategorized") {
          if (t.category !== null) return false;
        } else {
          if (t.category !== categoryFilter) return false;
        }
      }

      if (!query) return true;

      const title = t.title.toLowerCase();
      const notes = (t.notes ?? "").toLowerCase();

      return title.includes(query) || notes.includes(query);
    });
  }, [transactions, search, typeFilter, categoryFilter]);

  const hasFilter =
    search.trim().length > 0 ||
    typeFilter !== "all" ||
    categoryFilter !== "all";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {/* Top row: back + título + mês navegação */}
        <View style={styles.headerTopRow}>
          <Pressable
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] },
            ]}
            onPress={() => router.back()}
          >
            <XIcon size={22} weight="bold" color="rgba(255,255,255,0.85)" />
          </Pressable>

          <View style={styles.monthRow}>
            <Pressable
              onPress={() => handleMonthChange(-1)}
              style={styles.monthButton}
            >
              <CaretLeftIcon weight="duotone" color="rgba(255,255,255,0.70)" />
            </Pressable>

            <Text style={styles.monthTitle}>{monthLabel}</Text>

            <Pressable
              onPress={() => handleMonthChange(1)}
              style={styles.monthButton}
            >
              <CaretRightIcon weight="duotone" color="rgba(255,255,255,0.70)" />
            </Pressable>
          </View>

          {/* espaçador pra manter centralizado */}
          <View style={styles.headerRightSpacer} />
        </View>

        <Text style={styles.screenTitle}>Lançamentos</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchInputWrapper}>
            <MagnifyingGlassIcon
              size={20}
              weight="duotone"
              color="rgba(255,255,255,0.55)"
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar por título ou descrição"
              placeholderTextColor={"rgba(255,255,255,0.45)"}
              value={search}
              onChangeText={setSearch}
            />
            <Pressable
              style={({ pressed }) => [
                styles.filterButton,
                pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] },
                hasFilter && { backgroundColor: "rgba(255,179,90,0.22)" },
              ]}
              onPress={() => setFilterModalVisible(true)}
            >
              <FunnelIcon
                size={20}
                weight="duotone"
                color="rgba(255,255,255,0.85)"
              />
            </Pressable>
          </View>
        </View>
      </View>

      <FlatList
        data={filteredTransactions}
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
                        ? styles.amountIncome
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
            <Text style={styles.emptyTitle}>
              {hasFilter
                ? "Nenhum lançamento encontrado"
                : "Sem lançamentos neste mês"}
            </Text>
            <Text style={styles.emptySubtitle}>
              {hasFilter
                ? "Tente ajustar a busca ou limpar os filtros."
                : "Use o botão + nesta tela para adicionar um lançamento."}
            </Text>
          </View>
        }
        ItemSeparatorComponent={Separator}
      />
      <Pressable
        style={({ pressed }) => [
          styles.add,
          { bottom: 30 + insets.bottom },
          pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] },
        ]}
        onPress={() => router.push("/newEntry")}
      >
        <PlusIcon size={28} weight="bold" color="#fff" />
      </Pressable>

      <Modal
        visible={filterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setFilterModalVisible(false)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filtros</Text>

            <Text style={styles.modalLabel}>Tipo</Text>
            <View style={styles.chipsRow}>
              {(["all", "income", "expense"] as TypeFilter[]).map((t) => {
                const selected = typeFilter === t;
                const label =
                  t === "all"
                    ? "Todos"
                    : t === "income"
                      ? "Entradas"
                      : "Saídas";
                return (
                  <Pressable
                    key={t}
                    onPress={() => {
                      setTypeFilter(t);
                      setCategoryFilter("all");
                    }}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalLabel}>Categoria</Text>
            <View style={styles.chipsRow}>
              {categoryFilterOptions.map((c) => {
                const selected = categoryFilter === c.key;
                const disabled = typeFilter !== "expense";
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      if (!disabled) {
                        setCategoryFilter(c.key);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      disabled && styles.chipDisabled,
                      pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.clearButton}
              onPress={() => {
                setTypeFilter("all");
                setCategoryFilter("all");
                setSearch("");
                setFilterModalVisible(false);
              }}
            >
              <Text style={styles.clearButtonText}>Limpar filtros</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 10,
  },
  header: {
    padding: 20,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    padding: 8,
  },
  headerRightSpacer: {
    width: 38,
  },
  screenTitle: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: "bold",
    color: "rgba(255,255,255,0.85)",
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  monthButton: {
    padding: 10,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: "bold",
    textTransform: "capitalize",
    color: "rgba(255,255,255,0.75)",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 10,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "rgba(255,255,255,0.95)",
  },
  filterButton: {
    padding: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  transactionList: {
    paddingBottom: 20,
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
    elevation: 4,
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 3 },
  },
  transactionItemList: {
    padding: 15,
    backgroundColor: "rgba(255,255,255,0.06)",
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
  amountIncome: {
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    flex: 1,
  },
  modalCard: {
    backgroundColor: "rgba(10,10,26,0.98)",
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.95)",
    marginBottom: 10,
  },
  modalLabel: {
    fontSize: 13,
    marginBottom: 6,
    color: "rgba(255,255,255,0.75)",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipSelected: {
    borderColor: "#FFB35A",
    backgroundColor: "rgba(255,179,90,0.18)",
  },
  chipText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.80)",
  },
  chipTextSelected: {
    fontWeight: "700",
    color: "rgba(255,255,255,0.95)",
  },
  chipDisabled: {
    opacity: 0.6,
  },
  clearButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  clearButtonText: {
    fontSize: 13,
    color: "#FFB35A",
    fontWeight: "600",
  },
});
