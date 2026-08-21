import { listTransactionsByDateRange } from "@/src/db/transactions";
import {
  ExpenseCategoryOptions,
  isRunRateIncomeCategory,
} from "@/src/domain/categories";
import { calculateMonthlyProjection } from "@/src/domain/monthlyProjection";
import { Transaction, computePeriodStats } from "@/src/domain/transaction";
import {
  CategoryDonutChart,
  getCategoryDonutColor,
} from "@/src/ui/charts/CategoryDonutChart";
import { MonthlyIncomeExpenseChart } from "@/src/ui/charts/MonthlyIncomeExpenseChart";
import { WeeklyIncomeBarChart } from "@/src/ui/charts/WeeklyIncomeBarChart";
import { getMonthRange, getWeekRangeMonday } from "@/src/utils/date";
import {
  formatBRL,
  formatDay,
  formatSignedBRL,
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
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

type PeriodMode = "month" | "week";
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
  mode: PeriodMode,
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

const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

function getWeekdayLabelFromISO(dateISO: string) {
  const date = parseISODate(dateISO);
  return WEEKDAY_LABELS[date.getDay()];
}

function normalizeStoreName(title: string) {
  return title.trim().replace(/\s+/g, " ");
}

export default function Index() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const [monthTransactions, setMonthTransactions] = useState<Transaction[]>([]);
  const [monthPreviousTransactions, setMonthPreviousTransactions] = useState<
    Transaction[]
  >([]);

  const [weekTransactions, setWeekTransactions] = useState<Transaction[]>([]);
  const [weekPreviousTransactions, setWeekPreviousTransactions] = useState<
    Transaction[]
  >([]);

  const weekRunRateIncomeTransactions = useMemo(
    () =>
      weekTransactions.filter(
        (transaction) =>
          transaction.type === "income" &&
          isRunRateIncomeCategory(transaction.category),
      ),
    [weekTransactions],
  );

  const previousWeekRunRateIncomeTransactions = useMemo(
    () =>
      weekPreviousTransactions.filter(
        (transaction) =>
          transaction.type === "income" &&
          isRunRateIncomeCategory(transaction.category),
      ),
    [weekPreviousTransactions],
  );

  const weekStats = useMemo(
    () => computePeriodStats(weekRunRateIncomeTransactions),
    [weekRunRateIncomeTransactions],
  );

  const previousWeekStats = useMemo(
    () => computePeriodStats(previousWeekRunRateIncomeTransactions),
    [previousWeekRunRateIncomeTransactions],
  );

  const monthStats = useMemo(
    () => computePeriodStats(monthTransactions),
    [monthTransactions],
  );

  const previousMonthStats = useMemo(
    () => computePeriodStats(monthPreviousTransactions),
    [monthPreviousTransactions],
  );

  const weekIncomeDiffCents =
    weekStats.incomeCents - previousWeekStats.incomeCents;

  const monthNetDiffCents = monthStats.netCents - previousMonthStats.netCents;

  const monthLabel = monthLabelPT({
    year: selectedYear,
    month: selectedMonth,
  });
  const headerTitle = monthLabel;

  const todayKey = toISODate(new Date());

  const currentWeekRange = useMemo(
    () =>
      getWeekRangeMonday(parseISODate(todayKey), {
        clampEndToToday: true,
      }),
    [todayKey],
  );

  const isCurrentMonth =
    selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;

  const load = useCallback(async () => {
    const monthRange = getMonthRange(selectedYear, selectedMonth);
    const monthPreviousRange = previousRangeForMode(
      "month",
      selectedYear,
      selectedMonth,
      currentWeekRange,
    );

    const weekRange = currentWeekRange;
    const weekPreviousRange = previousRangeForMode(
      "week",
      selectedYear,
      selectedMonth,
      currentWeekRange,
    );

    const [monthItems, monthPreviousItems, weekItems, weekPreviousItems] =
      await Promise.all([
        listTransactionsByDateRange(db, monthRange.startISO, monthRange.endISO),
        listTransactionsByDateRange(
          db,
          monthPreviousRange.startISO,
          monthPreviousRange.endISO,
        ),
        listTransactionsByDateRange(db, weekRange.startISO, weekRange.endISO),
        listTransactionsByDateRange(
          db,
          weekPreviousRange.startISO,
          weekPreviousRange.endISO,
        ),
      ]);

    setMonthTransactions(monthItems);
    setMonthPreviousTransactions(monthPreviousItems);

    setWeekTransactions(weekItems);
    setWeekPreviousTransactions(weekPreviousItems);
  }, [db, selectedYear, selectedMonth, currentWeekRange]);

  const previewTransactions = useMemo(
    () => monthTransactions.slice(0, 5),
    [monthTransactions],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const incomeCents = monthStats.incomeCents;
  const expenseCents = monthStats.expenseCents;
  const totalCents = monthStats.netCents;
  const netDiffCents = monthNetDiffCents;

  const incomeTransactions = useMemo(
    () => monthTransactions.filter((item) => item.type === "income"),
    [monthTransactions],
  );

  const runRateIncomeTransactions = useMemo(
    () =>
      incomeTransactions.filter((transaction) =>
        isRunRateIncomeCategory(transaction.category),
      ),
    [incomeTransactions],
  );

  const projection = useMemo(() => {
    const currentDate = new Date();
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();

    const isSelectedCurrentMonth =
      currentDate.getFullYear() === selectedYear &&
      currentDate.getMonth() + 1 === selectedMonth;

    const elapsedDays = isSelectedCurrentMonth
      ? currentDate.getDate()
      : daysInMonth;

    return calculateMonthlyProjection({
      transactions: monthTransactions,
      elapsedDays,
      daysInMonth,
    });
  }, [monthTransactions, selectedYear, selectedMonth]);

  const categoryTotals = useMemo(() => {
    const rows = [
      ...ExpenseCategoryOptions.map((c) => ({
        key: c.key,
        label: c.label,
        value: monthStats.expenseByCategoryCents[c.key],
      })),
      {
        key: "uncategorized",
        label: "Sem categoria",
        value: monthStats.uncategorizedCents,
      },
    ];

    return rows.sort((a, b) => b.value - a.value).slice(0, 4);
  }, [monthStats]);

  const topExpenseCategories = useMemo(
    () => categoryTotals.filter((item) => item.value > 0).slice(0, 4),
    [categoryTotals],
  );

  const bestWeekdayInsight = useMemo(() => {
    const totalsByWeekday = new Map<string, number>();

    for (const item of runRateIncomeTransactions) {
      const weekday = getWeekdayLabelFromISO(item.dateISO);
      const currentTotal = totalsByWeekday.get(weekday) ?? 0;

      totalsByWeekday.set(weekday, currentTotal + item.amountCents);
    }

    const best = Array.from(totalsByWeekday.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];

    if (!best) {
      return null;
    }

    return {
      label: best[0],
      valueCents: best[1],
    };
  }, [runRateIncomeTransactions]);

  const bestStoreInsight = useMemo(() => {
    const totalsByStore = new Map<string, number>();

    for (const item of runRateIncomeTransactions) {
      const storeName = normalizeStoreName(item.title);

      if (!storeName) continue;

      const currentTotal = totalsByStore.get(storeName) ?? 0;

      totalsByStore.set(storeName, currentTotal + item.amountCents);
    }

    const best = Array.from(totalsByStore.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];

    if (!best) {
      return null;
    }

    return {
      label: best[0],
      valueCents: best[1],
    };
  }, [runRateIncomeTransactions]);

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
        <View style={styles.brandRow}>
          <View>
            <Text style={styles.brandText}>Mototrack</Text>
            <Text style={styles.brandSubtitle}>Seu resumo financeiro</Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] },
            ]}
            onPress={() => router.push("/settings")}
          >
            <GearSixIcon
              size={22}
              weight="duotone"
              color="rgba(255,255,255,0.8)"
            />
          </Pressable>
        </View>

        <View style={styles.heroTextBlock}>
          <Text style={styles.heroTitle}>Dashboard</Text>
          <Text style={styles.heroSubtitle}>
            Acompanhe seus ganhos, gastos e evolução.
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 24 + insets.bottom },
        ]}
      >
        <View style={{ paddingHorizontal: 20 }}>
          <View style={styles.periodCard}>
            <View style={styles.periodHeader}>
              <Text style={styles.periodLabel}>Resumo mensal</Text>

              <View style={styles.periodSelector}>
                <Pressable
                  onPress={() => handleMonthChange(-1)}
                  style={styles.periodArrowButton}
                >
                  <CaretLeftIcon
                    weight="duotone"
                    color="rgba(255,255,255,0.70)"
                  />
                </Pressable>

                <Text style={styles.periodTitle}>{headerTitle}</Text>

                <Pressable
                  onPress={() => handleMonthChange(1)}
                  style={styles.periodArrowButton}
                  disabled={isCurrentMonth}
                >
                  <CaretRightIcon
                    weight="duotone"
                    color="rgba(255,255,255,0.70)"
                    style={isCurrentMonth ? { opacity: 0.3 } : undefined}
                  />
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
                  R$ {formatSignedBRL(totalCents)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.mainChartCard}>
            <View style={styles.chartCardHeader}>
              <View>
                <Text style={styles.chartCardTitle}>Ganhos da semana</Text>

                <View style={styles.chartMetricRow}>
                  <Text style={styles.chartMetricValue}>
                    R$ {formatBRL(weekStats.incomeCents)}
                  </Text>
                  <Text style={styles.chartMetricSuffix}>total</Text>
                </View>
              </View>

              <View style={styles.compareBadge}>
                <Text
                  style={[
                    styles.compareBadgeValue,
                    weekIncomeDiffCents > 0
                      ? styles.positive
                      : weekIncomeDiffCents < 0
                        ? styles.negative
                        : null,
                  ]}
                >
                  {weekIncomeDiffCents === 0
                    ? "R$ 0,00"
                    : `R$ ${formatSignedBRL(weekIncomeDiffCents)}`}
                </Text>
                <Text style={styles.compareBadgeLabel}>vs semana anterior</Text>
              </View>
            </View>

            <View style={styles.weeklyChartViewport}>
              <WeeklyIncomeBarChart
                transactions={weekRunRateIncomeTransactions}
              />
            </View>
          </View>

          <View style={styles.monthlyChartCard}>
            <View style={styles.chartCardHeader}>
              <View>
                <Text style={styles.chartCardTitle}>Evolução do mês</Text>
                <View style={styles.chartMetricRow}>
                  <Text style={styles.chartMetricValue}>
                    R$ {formatSignedBRL(monthStats.netCents)}
                  </Text>
                  <Text style={styles.chartMetricSuffix}>saldo</Text>
                </View>
              </View>

              <View style={styles.compareBadge}>
                <Text
                  style={[
                    styles.compareBadgeValue,
                    monthNetDiffCents > 0
                      ? styles.positive
                      : monthNetDiffCents < 0
                        ? styles.negative
                        : null,
                  ]}
                >
                  {monthNetDiffCents === 0
                    ? "R$ 0,00"
                    : `R$ ${formatSignedBRL(monthNetDiffCents)}`}
                </Text>
                <Text style={styles.compareBadgeLabel}>vs mês anterior</Text>
              </View>
            </View>
            <View style={styles.monthlyChartViewport}>
              <MonthlyIncomeExpenseChart
                year={selectedYear}
                month={selectedMonth}
                currentTransactions={monthTransactions}
                previousTransactions={monthPreviousTransactions}
              />
            </View>
          </View>

          <View style={styles.insightsSection}>
            <Text style={styles.sectionTitle}>Insights</Text>

            <View style={styles.expenseOverviewCard}>
              <View style={styles.expenseOverviewHeader}>
                <View>
                  <Text style={styles.expenseOverviewTitle}>
                    Gastos por categoria
                  </Text>

                  <Text style={styles.expenseOverviewSubtitle}>
                    Maiores despesas do mês
                  </Text>
                </View>

                <Text style={styles.expenseOverviewTotal}>
                  R$ {formatBRL(monthStats.expenseCents)}
                </Text>
              </View>

              <View style={styles.expenseOverviewContent}>
                <CategoryDonutChart
                  data={topExpenseCategories}
                  size={92}
                  strokeWidth={15}
                />

                <View style={styles.expenseOverviewLegend}>
                  {topExpenseCategories.length > 0 ? (
                    topExpenseCategories.map((item, index) => (
                      <View key={item.key} style={styles.expenseLegendItem}>
                        <View
                          style={[
                            styles.categoryLegendDot,
                            {
                              backgroundColor: getCategoryDonutColor(index),
                            },
                          ]}
                        />

                        <View style={styles.expenseLegendText}>
                          <Text
                            style={styles.expenseLegendLabel}
                            numberOfLines={1}
                          >
                            {item.label}
                          </Text>

                          <Text style={styles.expenseLegendValue}>
                            R$ {formatBRL(item.value)}
                          </Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyInsightText}>
                      Sem gastos neste período
                    </Text>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.insightsGrid}>
              <View style={styles.smallInsightCard}>
                <Text style={styles.smallInsightLabel}>Projeção</Text>

                <Text
                  style={[
                    styles.smallInsightValue,
                    projection.projectedNetCents > 0
                      ? styles.positive
                      : projection.projectedNetCents < 0
                        ? styles.negative
                        : null,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  R$ {formatSignedBRL(projection.projectedNetCents)}
                </Text>

                <Text style={styles.smallInsightHint} numberOfLines={1}>
                  saldo estimado
                </Text>
              </View>

              <View style={styles.smallInsightCard}>
                <Text style={styles.smallInsightLabel}>Melhor dia</Text>

                {bestWeekdayInsight ? (
                  <>
                    <Text style={styles.smallInsightValue} numberOfLines={1}>
                      {bestWeekdayInsight.label}
                    </Text>

                    <Text style={styles.smallInsightHint} numberOfLines={1}>
                      R$ {formatBRL(bestWeekdayInsight.valueCents)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.smallInsightValue}>--</Text>
                    <Text style={styles.smallInsightHint}>sem dados</Text>
                  </>
                )}
              </View>

              <View style={styles.smallInsightCard}>
                <Text style={styles.smallInsightLabel}>Melhor loja</Text>

                {bestStoreInsight ? (
                  <>
                    <Text style={styles.smallInsightValue} numberOfLines={1}>
                      {bestStoreInsight.label}
                    </Text>

                    <Text style={styles.smallInsightHint} numberOfLines={1}>
                      R$ {formatBRL(bestStoreInsight.valueCents)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.smallInsightValue}>--</Text>
                    <Text style={styles.smallInsightHint}>sem dados</Text>
                  </>
                )}
              </View>
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

          {previewTransactions.length > 0 ? (
            <View style={styles.transactionList}>
              {previewTransactions.map((item, index) => (
                <View key={item.id}>
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
                        <MinusCircleIcon
                          size={24}
                          weight="duotone"
                          color="#ff3b30"
                        />
                      ) : (
                        <PlusCircleIcon
                          size={24}
                          weight="duotone"
                          color="#28a745"
                        />
                      )}

                      <View style={styles.dayCol}>
                        <Text style={styles.dayText}>Dia</Text>
                        <Text style={styles.dayNumber}>
                          {formatDay(item.dateISO)}
                        </Text>
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

                  {index < previewTransactions.length - 1 ? (
                    <Separator />
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>
                Sem lançamentos neste período
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 10,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandText: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.94)",
  },
  brandSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "rgba(255,255,255,0.56)",
  },
  mainChartCard: {
    marginTop: 14,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.055)",
  },

  chartCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 14,
  },

  chartCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.82)",
  },

  chartMetricRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },

  chartMetricValue: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: "rgba(255,255,255,0.96)",
  },

  chartMetricSuffix: {
    marginBottom: 4,
    fontSize: 13,
    color: "rgba(255,255,255,0.56)",
  },

  compareBadge: {
    minWidth: 112,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "flex-end",
    backgroundColor: "rgba(255,179,90,0.10)",
  },

  compareBadgeValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFB35A",
  },

  compareBadgeLabel: {
    marginTop: 2,
    fontSize: 11,
    textAlign: "right",
    color: "rgba(255,255,255,0.58)",
  },

  weeklyChartViewport: {
    height: 145,
    marginTop: 4,
  },
  monthlyChartCard: {
    marginTop: 14,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },

  monthlyChartViewport: {
    height: 165,
    marginTop: 8,
  },
  heroTextBlock: {
    marginTop: 28,
  },

  heroTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: "rgba(255,255,255,0.96)",
  },

  heroSubtitle: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 22,
    color: "rgba(255,255,255,0.62)",
  },

  periodCard: {
    marginTop: 10,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.055)",
  },

  periodHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  periodLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.72)",
  },

  periodSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  periodArrowButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  periodTitle: {
    minWidth: 112,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "800",
    textTransform: "capitalize",
    color: "rgba(255,255,255,0.90)",
  },
  settingsButton: {
    padding: 8,
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
  positive: {
    color: "#28a745",
  },
  negative: {
    color: "#ff3b30",
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
  scrollContent: {
    flexGrow: 1,
  },
  transactionList: {
    marginTop: 10,
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
  insightsSection: {
    marginTop: 18,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "rgba(255,255,255,0.94)",
    marginBottom: 10,
  },

  insightsGrid: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },

  smallInsightCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 88,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.045)",
    overflow: "hidden",
  },

  smallInsightLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.68)",
  },

  smallInsightValue: {
    marginTop: 9,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "rgba(255,255,255,0.94)",
  },

  smallInsightHint: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    color: "#FFB35A",
  },

  categoryLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  expenseOverviewCard: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },

  expenseOverviewHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  expenseOverviewTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "rgba(255,255,255,0.88)",
  },

  expenseOverviewSubtitle: {
    marginTop: 3,
    fontSize: 11,
    color: "rgba(255,255,255,0.48)",
  },

  expenseOverviewTotal: {
    fontSize: 15,
    fontWeight: "800",
    color: "rgba(255,255,255,0.90)",
  },

  expenseOverviewContent: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },

  expenseOverviewLegend: {
    flex: 1,
    gap: 9,
  },

  expenseLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  expenseLegendText: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  expenseLegendLabel: {
    flex: 1,
    fontSize: 12,
    color: "rgba(255,255,255,0.64)",
  },

  expenseLegendValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.88)",
  },

  emptyInsightText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.48)",
  },
});
