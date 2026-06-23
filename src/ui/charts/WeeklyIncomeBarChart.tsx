import { useFont } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Bar, CartesianChart } from "victory-native";

import type { Transaction } from "@/src/domain/transaction";
import { Nunito_400Regular } from "@expo-google-fonts/nunito";

type Props = {
  transactions: Transaction[];
};

const WEEKDAY_LABELS = [
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
  "Dom",
] as const;

function getMondayBasedDayIndex(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  // JS: 0=Dom, 1=Seg, ... 6=Sáb
  // queremos: Seg=0 ... Dom=6
  return (date.getDay() + 6) % 7;
}

function buildWeeklyIncomeData(transactions: Transaction[]) {
  const totals = [0, 0, 0, 0, 0, 0, 0];

  for (const t of transactions) {
    if (t.type !== "income") continue;

    const dayIndex = getMondayBasedDayIndex(t.dateISO);
    totals[dayIndex] += t.amountCents / 100;
  }

  return WEEKDAY_LABELS.map((label, index) => ({
    day: label,
    income: totals[index],
  }));
}

function formatYAxisLabel(value: number) {
  if (value >= 1000) {
    return `R$ ${(value / 1000).toFixed(1)}k`.replace(".", ",");
  }

  return `R$ ${Math.round(value)}`;
}

export function WeeklyIncomeBarChart({ transactions }: Props) {
  const font = useFont(Nunito_400Regular as any, 12);

  const data = useMemo(
    () => buildWeeklyIncomeData(transactions),
    [transactions],
  );

  const hasAnyIncome = data.some((item) => item.income > 0);

  if (!font) return null;

  if (!hasAnyIncome) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          Sem entradas registradas nesta semana.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* <View style={styles.legendSpacer} /> */}
      <View style={styles.chartWrapper}>
        <CartesianChart
          data={data}
          xKey="day"
          yKeys={["income"]}
          domainPadding={{ left: 28, right: 28, top: 16 }}
          axisOptions={{
            font,
            lineColor: "rgba(255,255,255,0.10)",
            labelColor: "rgba(255,255,255,0.70)",
            formatYLabel: (value) => formatYAxisLabel(Number(value)),
          }}
        >
          {({ points, chartBounds }) => (
            <Bar
              points={points.income}
              chartBounds={chartBounds}
              color="#28A745"
              barWidth={16}
              roundedCorners={{
                topLeft: 6,
                topRight: 6,
              }}
              animate={{ type: "timing", duration: 250 }}
            />
          )}
        </CartesianChart>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  legendSpacer: {
    minHeight: 78,
    marginBottom: 10,
  },
  chartWrapper: {
    height: 135,
  },
  emptyText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
  },
});
