import { DashPathEffect, useFont } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CartesianChart, Line } from "victory-native";

import type { Transaction } from "@/src/domain/transaction";
import { Nunito_400Regular } from "@expo-google-fonts/nunito";

type Props = {
  year: number;
  month: number; // 1..12
  currentTransactions: Transaction[];
  previousTransactions: Transaction[];
};

type Datum = {
  day: number;
  incomeCurrent: number | null;
  expenseCurrent: number | null;
  incomePrevious: number | null;
  expensePrevious: number | null;
  incomeProjected: number | null;
  expenseProjected: number | null;
};

function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}

function buildDailyData(
  transactions: Transaction[],
  currentMonthDays: number,
  type: "income" | "expense",
) {
  const values = Array(currentMonthDays).fill(0);

  for (const t of transactions) {
    if (t.type !== type) continue;

    const day = Number(t.dateISO.slice(8, 10));
    if (!Number.isFinite(day) || day < 1 || day > currentMonthDays) continue;

    values[day - 1] += t.amountCents;
  }

  return values;
}

function toAccumulated(values: number[]) {
  let acc = 0;

  return values.map((value) => {
    acc += value;
    return acc;
  });
}

function formatYAxisLabel(value: number) {
  if (value >= 1000) {
    return `R$ ${(value / 1000).toFixed(1)}k`.replace(".", ",");
  }

  return `R$ ${Math.round(value)}`;
}

export function MonthlyIncomeExpenseChart({
  year,
  month,
  currentTransactions,
  previousTransactions,
}: Props) {
  const font = useFont(Nunito_400Regular as any, 11);

  const [visibleSeries, setVisibleSeries] = useState({
    current: true,
    previous: true,
  });

  const data: Datum[] = useMemo(() => {
    const currentMonthDays = daysInMonth(year, month);

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthDays = daysInMonth(prevYear, prevMonth);

    const currentIncomeDaily = buildDailyData(
      currentTransactions,
      currentMonthDays,
      "income",
    );

    const currentExpenseDaily = buildDailyData(
      currentTransactions,
      currentMonthDays,
      "expense",
    );

    const previousIncomeDaily = buildDailyData(
      previousTransactions,
      prevMonthDays,
      "income",
    );

    const previousExpenseDaily = buildDailyData(
      previousTransactions,
      prevMonthDays,
      "expense",
    );

    const currentIncomeAcc = toAccumulated(currentIncomeDaily);
    const currentExpenseAcc = toAccumulated(currentExpenseDaily);
    const previousIncomeAcc = toAccumulated(previousIncomeDaily);
    const previousExpenseAcc = toAccumulated(previousExpenseDaily);

    const now = new Date();
    const isSelectedCurrentMonth =
      now.getFullYear() === year && now.getMonth() + 1 === month;

    const lastActualDay = isSelectedCurrentMonth
      ? now.getDate()
      : currentMonthDays;

    const safeLastActualDay = Math.max(
      1,
      Math.min(lastActualDay, currentMonthDays),
    );
    const avgIncomePerDay =
      safeLastActualDay > 0
        ? currentIncomeAcc[safeLastActualDay - 1] / safeLastActualDay
        : 0;
    const avgExpensePerDay =
      safeLastActualDay > 0
        ? currentExpenseAcc[safeLastActualDay - 1] / safeLastActualDay
        : 0;

    return Array.from({ length: currentMonthDays }, (_, i) => {
      const day = i + 1;

      const previousIncomeValue =
        i < previousIncomeAcc.length ? previousIncomeAcc[i] / 100 : null;

      const previousExpenseValue =
        i < previousExpenseAcc.length ? previousExpenseAcc[i] / 100 : null;

      const isFuture = isSelectedCurrentMonth && day > safeLastActualDay;

      let incomeProjected: number | null = null;

      let expenseProjected: number | null = null;

      if (isSelectedCurrentMonth && day >= safeLastActualDay) {
        const projectedDaysAfterStart = day - safeLastActualDay;
        incomeProjected =
          (currentIncomeAcc[safeLastActualDay - 1] +
            avgIncomePerDay * projectedDaysAfterStart) /
          100;
        expenseProjected =
          (currentExpenseAcc[safeLastActualDay - 1] +
            avgExpensePerDay * projectedDaysAfterStart) /
          100;
      }
      return {
        day,
        incomeCurrent: isFuture ? null : currentIncomeAcc[i] / 100,
        expenseCurrent: isFuture ? null : currentExpenseAcc[i] / 100,
        incomePrevious: previousIncomeValue,
        expensePrevious: previousExpenseValue,
        incomeProjected,
        expenseProjected,
      };
    });
  }, [currentTransactions, previousTransactions, year, month]);

  const hasAnyData = data.some(
    (item) =>
      (item.incomeCurrent ?? 0) > 0 ||
      (item.expenseCurrent ?? 0) > 0 ||
      (item.incomePrevious ?? 0) > 0 ||
      (item.expensePrevious ?? 0) > 0 ||
      (item.incomeProjected ?? 0) > 0 ||
      (item.expenseProjected ?? 0) > 0,
  );

  if (!font) return null;

  if (!hasAnyData) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Sem dados para exibir neste mês.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.chartWrapper}>
        <CartesianChart
          data={data}
          xKey="day"
          yKeys={[
            "incomeCurrent",
            "expenseCurrent",
            "incomePrevious",
            "expensePrevious",
            "incomeProjected",
            "expenseProjected",
          ]}
          xAxis={{
            font,
            tickCount: 5,
            labelColor: "rgba(255,255,255,0.48)",
            lineColor: "rgba(255,255,255,0.08)",
            formatXLabel: (value) => String(value),
          }}
          yAxis={[
            {
              yKeys: [
                "incomeCurrent",
                "expenseCurrent",
                "incomePrevious",
                "expensePrevious",
                "incomeProjected",
                "expenseProjected",
              ],
              font,
              tickCount: 4,
              labelColor: "rgba(255,255,255,0.48)",
              lineColor: "rgba(255,255,255,0.08)",
              formatYLabel: (value) => formatYAxisLabel(Number(value ?? 0)),
            },
          ]}
          domainPadding={{ left: 12, right: 12, top: 20, bottom: 8 }}
        >
          {({ points }) => (
            <>
              {visibleSeries.previous ? (
                <Line
                  points={points.incomePrevious}
                  strokeWidth={1.5}
                  color="rgba(40,167,69,0.22)"
                  animate={{ type: "timing", duration: 250 }}
                />
              ) : null}
              {visibleSeries.previous ? (
                <Line
                  points={points.expensePrevious}
                  strokeWidth={1.5}
                  color="rgba(255,59,48,0.22)"
                  animate={{ type: "timing", duration: 250 }}
                />
              ) : null}
              {visibleSeries.current ? (
                <Line
                  points={points.incomeCurrent}
                  strokeWidth={2.5}
                  color="#28A745"
                  animate={{ type: "timing", duration: 250 }}
                />
              ) : null}
              {visibleSeries.current ? (
                <Line
                  points={points.expenseCurrent}
                  strokeWidth={2.5}
                  color="#FF3B30"
                  animate={{ type: "timing", duration: 250 }}
                />
              ) : null}
              {visibleSeries.current ? (
                <Line
                  points={points.incomeProjected}
                  strokeWidth={2}
                  color="#57C86B"
                  animate={{ type: "timing", duration: 250 }}
                >
                  <DashPathEffect intervals={[10, 5]} />
                </Line>
              ) : null}
              {visibleSeries.current ? (
                <Line
                  points={points.expenseProjected}
                  strokeWidth={2}
                  color="#FF6A61"
                  animate={{ type: "timing", duration: 250 }}
                >
                  <DashPathEffect intervals={[10, 5]} />
                </Line>
              ) : null}
            </>
          )}
        </CartesianChart>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.incomeDot]} />
          <Text style={styles.legendText}>Entradas</Text>
        </View>

        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.expenseDot]} />
          <Text style={styles.legendText}>Saídas</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  chartWrapper: {
    height: 140,
  },

  legendRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
  },

  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  incomeDot: {
    backgroundColor: "#28A745",
  },

  expenseDot: {
    backgroundColor: "#FF3B30",
  },

  legendText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.58)",
  },

  emptyContainer: {
    height: 190,
    justifyContent: "center",
  },

  emptyText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.62)",
  },
});
