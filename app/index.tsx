import { listTransactionsByMonth } from "@/src/db/transactions";
import { Transaction, computeMonthStats } from "@/src/domain/transaction";
import { formatBRL, formatDay, monthLabelPT } from "@/src/utils/format";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  CaretLeftIcon,
  CaretRightIcon,
  ChartBarIcon,
  FunnelIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  PlusIcon,
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

// label de hora usando createdAt.
// function formatTimeFromCreatedAt(ms: number) {
//   return new Date(ms).toLocaleTimeString("pt-BR", {
//     hour: "2-digit",
//     minute: "2-digit",
//   });
// }

type TypeFilter = "all" | "income" | "expense";

type CategoryFilter =
  | "all"
  | "fuel"
  | "food"
  | "maintenance"
  | "vehicle"
  | "other"
  | "uncategorized";

export default function Index() {
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const db = useSQLiteContext();

  const Separator = () => <View style={styles.separator} />;

  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const monthStats = useMemo(
    () => computeMonthStats(transactions),
    [transactions]
  );

  const incomeCents = monthStats.incomeCents;
  const expenseCents = monthStats.expenseCents;
  const totalCents = incomeCents - expenseCents;

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  // Lista filtrada com base em busca + tipo
  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transactions.filter((t) => {
      // Filtra por tipo (entradas/saídas)
      if (typeFilter !== "all" && t.type !== typeFilter) {
        return false;
      }

      //Filtra por categoria
      if (categoryFilter !== "all") {
        if (t.type !== "expense") return false;

        const cat = (t.category ?? "uncategorized") as CategoryFilter;
        if (cat !== categoryFilter) return false;
      }

      // Se não tem busca, só o filtro de tipo vale
      if (!query) return true;

      // Busca em título + notas
      const title = t.title.toLowerCase();
      const notes = (t.notes ?? "").toLowerCase();

      return title.includes(query) || notes.includes(query);
    });
  }, [transactions, search, typeFilter, categoryFilter]);

  const hasFilter =
    search.trim().length > 0 ||
    typeFilter !== "all" ||
    categoryFilter !== "all";

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const isCurrentMonth =
    selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;

  const monthLabel = monthLabelPT({
    year: selectedYear,
    month: selectedMonth,
  });

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
        <View style={styles.headerTopRow}>
          <Pressable
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] },
            ]}
            onPress={() => router.push("/settings")}
          >
            <GearSixIcon
              size={24}
              weight="duotone"
              color="rgba(255,255,255,0.8)"
            />
          </Pressable>
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => handleMonthChange(-1)}
              style={styles.monthButton}
            >
              <CaretLeftIcon weight="duotone" color="rgba(255,255,255,0.70)" />
            </Pressable>

            <View style={styles.stats}>
              {/* <ChartBarIcon
              size={20}
              weight="duotone"
              color="rgba(255,255,255,0.70)"
            /> */}

              <Text style={styles.monthTitle}>{monthLabel}</Text>
            </View>

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
          {/* “fantasma” à direita para manter o monthRow realmente centralizado */}
          <View style={styles.headerRightSpacer} />
        </View>

        <View
          style={{
            alignItems: "flex-end",
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text style={styles.summaryTitle}>Resumo do mês</Text>

          <Pressable
            style={({ pressed }) => [
              styles.statsButton,
              pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
            ]}
            onPress={() =>
              router.push({
                pathname: "/stats",
                params: {
                  year: String(selectedYear),
                  month: String(selectedMonth),
                },
              })
            }
          >
            <ChartBarIcon
              size={18}
              weight="duotone"
              color="rgba(255,255,255,0.90)"
            />
            <Text style={styles.statsButtonText}>Ver detalhes</Text>
          </Pressable>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Entradas</Text>
            <Text style={styles.summaryNumber} numberOfLines={1}>
              R$ {formatBRL(incomeCents)}
            </Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Saídas</Text>
            <Text style={styles.summaryNumber} numberOfLines={1}>
              R$ {formatBRL(expenseCents)}
            </Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Saldo</Text>
            <Text style={styles.summaryNumber} numberOfLines={1}>
              R$ {formatBRL(totalCents)}
            </Text>
          </View>
        </View>

        {/* <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <Pressable
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.06)",
              alignItems: "center",
            }}
            onPress={() => exportBackup(db)}
          >
            <Text style={{ color: "rgba(255,255,255,0.90)" }}>
              Exportar backup
            </Text>
          </Pressable>

          <Pressable
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.06)",
              alignItems: "center",
            }}
            onPress={() => importBackupFromFile(db)}
          >
            <Text style={{ color: "rgba(255,255,255,0.90)" }}>
              Importar backup
            </Text>
          </Pressable>
        </View> */}

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
            <Text style={styles.emptyTitle}>
              {hasFilter
                ? "Nenhum lançamento encontrado"
                : "Sem lançamentos neste mês"}
            </Text>
            <Text style={styles.emptySubtitle}>
              {hasFilter
                ? "Tente ajustar a busca ou limpar os filtros."
                : "Toque no botão + para registrar a sua primeira entrada ou saída."}
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
                    onPress={() => setTypeFilter(t)}
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
              {(
                [
                  { key: "all", label: "Todas" },
                  { key: "fuel", label: "Combustível" },
                  { key: "food", label: "Alimentação" },
                  { key: "maintenance", label: "Manutenção" },
                  { key: "vehicle", label: "Veículo" },
                  { key: "other", label: "Outros" },
                  { key: "uncategorized", label: "Sem categoria" },
                ] as const
              ).map((c) => {
                const selected = categoryFilter === c.key;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setCategoryFilter(c.key)}
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

export const styles = StyleSheet.create({
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
    marginBottom: 10,
  },
  settingsButton: {
    padding: 8,
  },
  headerRightSpacer: {
    // Tamanho aproximado do botão de configurações, pra balancear a linha
    width: 38,
  },
  monthRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
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
    marginTop: 6,
    marginBottom: 6,
    color: "rgba(255,255,255,0.70)",
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  summaryCard: {
    flex: 1,
    minWidth: 0,
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
    fontSize: 14, //Original 16, mas 14 pra caber
    fontWeight: "600",
    color: "rgba(255,255,255,0.70)",
  },
  statsButton: {
    marginTop: 18,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  statsButtonText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 14,
    fontWeight: "600",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
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
