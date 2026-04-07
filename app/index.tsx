import { listTransactionsByDateRange } from "@/src/db/transactions";
import { CategoryOptions } from "@/src/domain/categories";
import { Transaction, computePeriodStats } from "@/src/domain/transaction";
import { getMonthRange, getWeekRangeMonday } from "@/src/utils/date";
import {
  formatBRL,
  formatDay,
  monthLabelPT,
  toISODate,
} from "@/src/utils/format";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  CardsThreeIcon,
  CaretLeftIcon,
  CaretRightIcon,
  GearSixIcon,
  MinusCircleIcon,
  PlusCircleIcon,
} from "phosphor-react-native";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

type ViewMode = "month" | "week";
type PeriodRange = { startISO: string; endISO: string };

function parseISODate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

function daysBetweenInclusive(startISO: string, endISO: string) {
  const msDay = 24 * 60 * 60 * 1000;
  const start = parseISODate(startISO).getTime();
  const end = parseISODate(endISO).getTime();
  const days = Math.floor((end - start) / msDay) + 1;
  return Math.max(1, days);
}

function previousRangeForMode(
  mode: ViewMode,
  selectedYear: number,
  selectedMonth: number,
  currentWeekRange: PeriodRange,
): PeriodRange {
  if (mode === "month") {
    const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
    const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;
    return getMonthRange(prevYear, prevMonth);
  }

  const weekDaysShown = daysBetweenInclusive(
    currentWeekRange.startISO,
    currentWeekRange.endISO,
  );
  const prevStart = parseISODate(currentWeekRange.startISO);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd = new Date(prevStart);
  prevEnd.setDate(prevEnd.getDate() + (weekDaysShown - 1));

  return { startISO: toISODate(prevStart), endISO: toISODate(prevEnd) };
}

export default function Index() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<ViewMode>("month");

  const [periodTransactions, setPeriodTransactions] = useState<Transaction[]>(
    [],
  );
  const [previousPeriodTransactions, setPreviousPeriodTransactions] = useState<
    Transaction[]
  >([]);

  const monthLabel = monthLabelPT({
    year: selectedYear,
    month: selectedMonth,
  });
  const headerTitle = viewMode === "month" ? monthLabel : "Semana atual";

  const currentWeekRange = useMemo(
    () => getWeekRangeMonday(new Date(), { clampEndToToday: true }),
    [viewMode],
  );

  const isCurrentMonth =
    selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;

  const load = useCallback(async () => {
    const currentRange =
      viewMode === "month"
        ? getMonthRange(selectedYear, selectedMonth)
        : currentWeekRange;

    const previousRange = previousRangeForMode(
      viewMode,
      selectedYear,
      selectedMonth,
      currentWeekRange,
    );

    const [currentItems, previousItems] = await Promise.all([
      listTransactionsByDateRange(
        db,
        currentRange.startISO,
        currentRange.endISO,
      ),
      listTransactionsByDateRange(
        db,
        previousRange.startISO,
        previousRange.endISO,
      ),
    ]);

    setPeriodTransactions(currentItems);
    setPreviousPeriodTransactions(previousItems);
  }, [db, viewMode, selectedYear, selectedMonth, currentWeekRange]);

  const previewTransactions = useMemo(
    () => periodTransactions.slice(0, 5),
    [periodTransactions],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const currentStats = useMemo(
    () => computePeriodStats(periodTransactions),
    [periodTransactions],
  );
  const previousStats = useMemo(
    () => computePeriodStats(previousPeriodTransactions),
    [previousPeriodTransactions],
  );

  const incomeCents = currentStats.incomeCents;
  const expenseCents = currentStats.expenseCents;
  const totalCents = currentStats.netCents;
  const netDiffCents = currentStats.netCents - previousStats.netCents;

  const projection = useMemo(() => {
    const currentDate = new Date();
    const totalDaysInPeriod =
      viewMode === "month"
        ? new Date(selectedYear, selectedMonth, 0).getDate()
        : 7;

    const elapsedDays =
      viewMode === "month"
        ? (() => {
            const daysInMonth = new Date(
              selectedYear,
              selectedMonth,
              0,
            ).getDate();
            const isSelectedCurrentMonth =
              currentDate.getFullYear() === selectedYear &&
              currentDate.getMonth() + 1 === selectedMonth;
            const currentDay = isSelectedCurrentMonth
              ? currentDate.getDate()
              : daysInMonth;
            return Math.max(1, Math.min(currentDay, daysInMonth));
          })()
        : daysBetweenInclusive(
            currentWeekRange.startISO,
            currentWeekRange.endISO,
          );

    const avgIncomePerDayCents = currentStats.incomeCents / elapsedDays;
    const avgExpensePerDayCents = currentStats.expenseCents / elapsedDays;
    const avgNetPerDayCents = currentStats.netCents / elapsedDays;

    return {
      projectedIncomeCents: Math.round(
        avgIncomePerDayCents * totalDaysInPeriod,
      ),
      projectedExpenseCents: Math.round(
        avgExpensePerDayCents * totalDaysInPeriod,
      ),
      projectedNetCents: Math.round(avgNetPerDayCents * totalDaysInPeriod),
      label: viewMode === "month" ? "Projeção do mês" : "Projeção da semana",
    };
  }, [
    currentStats,
    viewMode,
    selectedYear,
    selectedMonth,
    currentWeekRange.startISO,
    currentWeekRange.endISO,
  ]);

  const categoryTotals = useMemo(() => {
    const rows = [
      ...CategoryOptions.map((c) => ({
        key: c.key,
        label: c.label,
        value: currentStats.expenseByCategoryCents[c.key],
      })),
      {
        key: "uncategorized",
        label: "Sem categoria",
        value: currentStats.uncategorizedCents,
      },
    ];

    return rows.sort((a, b) => b.value - a.value).slice(0, 4);
  }, [currentStats]);

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

  const Separator = () => <View style={styles.separator} />;

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
              disabled={viewMode === "week"}
            >
              <CaretLeftIcon
                weight="duotone"
                color="rgba(255,255,255,0.70)"
                style={viewMode === "week" ? { opacity: 0.3 } : undefined}
              />
            </Pressable>

            <Text style={styles.monthTitle}>{headerTitle}</Text>

            <Pressable
              onPress={() => handleMonthChange(1)}
              style={styles.monthButton}
              disabled={viewMode === "week" || isCurrentMonth}
            >
              <CaretRightIcon
                weight="duotone"
                color="rgba(255,255,255,0.70)"
                style={
                  viewMode === "week" || isCurrentMonth
                    ? { opacity: 0.3 }
                    : undefined
                }
              />
            </Pressable>
          </View>

          <View style={styles.headerRightSpacer} />
        </View>

        <View style={styles.summaryHeaderRow}>
          <Text style={styles.summaryTitle}>Dashboard</Text>
          <View style={styles.viewModeRow}>
            <Pressable
              style={({ pressed }) => [
                styles.viewModeChip,
                viewMode === "month" && styles.viewModeChipSelected,
                pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
              ]}
              onPress={() => setViewMode("month")}
            >
              <Text
                style={[
                  styles.viewModeChipText,
                  viewMode === "month" && styles.viewModeChipTextSelected,
                ]}
              >
                Mensal
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.viewModeChip,
                viewMode === "week" && styles.viewModeChipSelected,
                pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
              ]}
              onPress={() => setViewMode("week")}
            >
              <Text
                style={[
                  styles.viewModeChipText,
                  viewMode === "week" && styles.viewModeChipTextSelected,
                ]}
              >
                Semanal
              </Text>
            </Pressable>
          </View>
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

        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Saldo anterior</Text>
            <Text style={styles.infoValue}>
              R$ {formatBRL(previousStats.netCents)}
            </Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Diferença vs anterior</Text>
            <Text
              style={[
                styles.infoValue,
                netDiffCents > 0
                  ? styles.positive
                  : netDiffCents < 0
                    ? styles.negative
                    : null,
              ]}
            >
              {netDiffCents === 0
                ? "R$ 0,00"
                : `${netDiffCents > 0 ? "+" : "-"}R$ ${formatBRL(
                    Math.abs(netDiffCents),
                  )}`}
            </Text>
          </View>

          <View style={[styles.infoCard, styles.infoCardFull]}>
            <Text style={styles.infoLabel}>{projection.label}</Text>
            <Text style={styles.infoLine}>
              Entradas:{" "}
              <Text style={styles.infoValueInline}>
                R$ {formatBRL(projection.projectedIncomeCents)}
              </Text>
            </Text>
            <Text style={styles.infoLine}>
              Saídas:{" "}
              <Text style={styles.infoValueInline}>
                R$ {formatBRL(projection.projectedExpenseCents)}
              </Text>
            </Text>
            <Text style={styles.infoLine}>
              Saldo:{" "}
              <Text
                style={[
                  styles.infoValueInline,
                  projection.projectedNetCents > 0
                    ? styles.positive
                    : projection.projectedNetCents < 0
                      ? styles.negative
                      : null,
                ]}
              >
                R$ {formatBRL(projection.projectedNetCents)}
              </Text>
            </Text>
          </View>

          <View style={[styles.infoCard, styles.infoCardFull]}>
            <Text style={styles.infoLabel}>Gasto por categoria (top 4)</Text>
            {categoryTotals.every((c) => c.value === 0) ? (
              <Text style={styles.emptySubtitle}>Sem gastos no período.</Text>
            ) : (
              categoryTotals.map((c) => (
                <View key={c.key} style={styles.categoryRow}>
                  <Text style={styles.categoryLabel}>{c.label}</Text>
                  <Text style={styles.categoryValue}>
                    R$ {formatBRL(c.value)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle}>Últimos lançamentos</Text>
          <Pressable
            style={({ pressed }) => [
              styles.allButton,
              pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
            ]}
            onPress={() =>
              router.push({
                pathname: "/transactions",
                params: {
                  year: String(selectedYear),
                  month: String(selectedMonth),
                },
              })
            }
          >
            <CardsThreeIcon size={18} weight="bold" color="#1b7a33" />
            <Text style={styles.allButtonText}>Ver todos</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={previewTransactions}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.transactionList,
          { paddingBottom: insets.bottom },
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
                    {item.type === "income" ? "+" : "-"}R${" "}
                    {formatBRL(item.amountCents)}
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Sem lançamentos</Text>
            <Text style={styles.emptySubtitle}>
              Use o botão + para registrar sua primeira entrada ou saída.
            </Text>
          </View>
        }
        ItemSeparatorComponent={Separator}
      />
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
  },
  settingsButton: {
    padding: 8,
  },
  headerRightSpacer: {
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
  summaryHeaderRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "rgba(255,255,255,0.85)",
  },
  viewModeRow: {
    flexDirection: "row",
    alignSelf: "center",
    gap: 8,
  },
  viewModeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  viewModeChipSelected: {
    borderColor: "#FFB35A",
    backgroundColor: "rgba(255,179,90,0.18)",
  },
  viewModeChipText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
  },
  viewModeChipTextSelected: {
    fontWeight: "700",
    color: "rgba(255,255,255,0.95)",
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
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
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.90)",
  },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  infoCard: {
    flexBasis: "48%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  infoCardFull: {
    flexBasis: "100%",
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 6,
    color: "rgba(255,255,255,0.70)",
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "800",
    color: "rgba(255,255,255,0.95)",
  },
  infoLine: {
    fontSize: 13,
    marginTop: 2,
    color: "rgba(255,255,255,0.85)",
  },
  infoValueInline: {
    fontSize: 13,
    fontWeight: "800",
    color: "rgba(255,255,255,0.95)",
  },
  positive: {
    color: "#28a745",
  },
  negative: {
    color: "#ff3b30",
  },
  categoryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    gap: 10,
  },
  categoryLabel: {
    fontSize: 13,
    color: "rgba(255,255,255,0.90)",
  },
  categoryValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.95)",
  },
  previewHeader: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.88)",
  },
  allButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 10,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  allButtonText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontWeight: "700",
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
    paddingVertical: 24,
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
