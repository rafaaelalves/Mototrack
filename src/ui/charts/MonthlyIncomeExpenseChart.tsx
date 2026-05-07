import { DashPathEffect, useFont } from "@shopify/react-native-skia";
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
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
  xValue: number; // dia do mês (1..31)
  incomeCurrent: number | null; // R$
  expenseCurrent: number | null; // R$
  incomePrevious: number | null; // R$
  expensePrevious: number | null; // R$
  incomeProjected: number | null; // R$
  expenseProjected: number | null; // R$
};

function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}

function buildDailyData(
  transactions: Transaction[],
  totalDays: number,
  type: "income" | "expense",
) {
  const values = Array(totalDays).fill(0);
  for (const t of transactions) {
    if (t.type !== type) continue;

    const day = Number(t.dateISO.slice(8, 10));
    if (!Number.isFinite(day) || day < 1 || day > totalDays) continue;

    values[day - 1] += t.amountCents;
  }
  return values;
}

function toAccumulated(values: number[]) {
  let acc = 0;
  return values.map((v) => {
    acc += v;
    return acc;
  });
}

export function MonthlyIncomeExpenseChart({
  year,
  month,
  currentTransactions,
  previousTransactions,
}: Props) {
  // Importante: no Victory Native, se não passar font no axis, label pode nem renderizar.
  // (docs do CartesianChart)
  const font = useFont(Nunito_400Regular as any, 12);

  const [visibleSeries, setVisibleSeries] = useState({
    incomeCurrent: true,
    expenseCurrent: true,
    incomePrevious: true,
    expensePrevious: true,
  });

  function toggleSeries(key: keyof typeof visibleSeries) {
    setVisibleSeries((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

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
      const day = i + 1; // 0-based index for the day

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
        xValue: day,
        incomeCurrent: isFuture ? null : currentIncomeAcc[i] / 100,
        expenseCurrent: isFuture ? null : currentExpenseAcc[i] / 100,

        incomePrevious: previousIncomeValue,
        expensePrevious: previousExpenseValue,

        incomeProjected,
        expenseProjected,
      };
    });
  }, [currentTransactions, previousTransactions, year, month]);

  if (!font) return null;

  const hasAny = data.some(
    (d) =>
      d.incomeCurrent !== null ||
      d.expenseCurrent !== null ||
      d.incomePrevious !== null ||
      d.expensePrevious !== null,
  );
  if (!hasAny) {
    return (
      <View style={{ justifyContent: "center", minHeight: 210 }}>
        <Text style={{ opacity: 0.7, color: "rgba(255,255,255,0.70)" }}>
          Sem dados para exibir o gráfico.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View style={{ height: 210 }}>
        <CartesianChart
          data={data}
          xKey="xValue"
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
            tickCount: 6,
            labelColor: "rgba(255,255,255,0.72)", // texto do eixo X
            lineColor: "rgba(255,255,255,0.18)", // linha do eixo X (com alpha)
            formatXLabel: (v) => String(v),
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
              tickCount: 5,
              labelColor: "rgba(255,255,255,0.72)", // texto do eixo Y
              lineColor: "rgba(255,255,255,0.18)", // linha do eixo Y
              formatYLabel: (v) => `R$ ${(v ?? 0).toFixed(0)}`,
            },
          ]}
          domainPadding={{ left: 18, right: 18, top: 12, bottom: 10 }}
        >
          {({ points }) => (
            <>
              {/* mês anterior */}
              {visibleSeries.incomePrevious ? (
                <Line
                  points={points.incomePrevious}
                  strokeWidth={1.5}
                  color="#7CB58A"
                />
              ) : null}
              {visibleSeries.expensePrevious ? (
                <Line
                  points={points.expensePrevious}
                  strokeWidth={1.5}
                  color="#CC7B75"
                />
              ) : null}

              {/* mês atual real */}
              {visibleSeries.incomeCurrent ? (
                <Line
                  points={points.incomeCurrent}
                  strokeWidth={2.5}
                  color="#28A745"
                />
              ) : null}
              {visibleSeries.expenseCurrent ? (
                <Line
                  points={points.expenseCurrent}
                  strokeWidth={2.5}
                  color="#FF3B30"
                />
              ) : null}

              {/* projeção tracejada */}
              {visibleSeries.incomeCurrent ? (
                <Line
                  points={points.incomeProjected}
                  strokeWidth={2}
                  color="#57C86B"
                  // pathEffect={<DashPathEffect intervals={[8, 6]} />}
                >
                  <DashPathEffect intervals={[10, 5]} />
                </Line>
              ) : null}
              {visibleSeries.expenseCurrent ? (
                <Line
                  points={points.expenseProjected}
                  strokeWidth={2}
                  color="#FF6A61"
                  // pathEffect={<DashPathEffect intervals={[8, 6]} />}
                >
                  <DashPathEffect intervals={[10, 5]} />
                </Line>
              ) : null}
            </>
          )}
        </CartesianChart>
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 25,
          minHeight: 78,
          alignContent: "flex-start",
        }}
      >
        <Pressable
          onPress={() => toggleSeries("incomeCurrent")}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: visibleSeries.incomeCurrent
              ? "#28A745"
              : "rgba(255,255,255,0.15)",
            backgroundColor: visibleSeries.incomeCurrent
              ? "rgba(40,167,69,0.18)"
              : "rgba(255,255,255,0.04)",
          }}
        >
          <Text
            style={{
              color: visibleSeries.incomeCurrent
                ? "#28A745"
                : "rgba(255,255,255,0.65)",
              fontSize: 12,
            }}
          >
            Entradas atual
          </Text>
        </Pressable>

        <Pressable
          onPress={() => toggleSeries("expenseCurrent")}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: visibleSeries.expenseCurrent
              ? "#FF3B30"
              : "rgba(255,255,255,0.15)",
            backgroundColor: visibleSeries.expenseCurrent
              ? "rgba(255,59,48,0.18)"
              : "rgba(255,255,255,0.04)",
          }}
        >
          <Text
            style={{
              color: visibleSeries.expenseCurrent
                ? "#FF3B30"
                : "rgba(255,255,255,0.65)",
              fontSize: 12,
            }}
          >
            Saídas atual
          </Text>
        </Pressable>

        <Pressable
          onPress={() => toggleSeries("incomePrevious")}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: visibleSeries.incomePrevious
              ? "#7CB58A"
              : "rgba(255,255,255,0.15)",
            backgroundColor: visibleSeries.incomePrevious
              ? "rgba(124,181,138,0.18)"
              : "rgba(255,255,255,0.04)",
          }}
        >
          <Text
            style={{
              color: visibleSeries.incomePrevious
                ? "#7CB58A"
                : "rgba(255,255,255,0.65)",
              fontSize: 12,
            }}
          >
            Entradas anterior
          </Text>
        </Pressable>

        <Pressable
          onPress={() => toggleSeries("expensePrevious")}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: visibleSeries.expensePrevious
              ? "#CC7B75"
              : "rgba(255,255,255,0.15)",
            backgroundColor: visibleSeries.expensePrevious
              ? "rgba(204,123,117,0.18)"
              : "rgba(255,255,255,0.04)",
          }}
        >
          <Text
            style={{
              color: visibleSeries.expensePrevious
                ? "#CC7B75"
                : "rgba(255,255,255,0.65)",
              fontSize: 12,
            }}
          >
            Saídas anterior
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
