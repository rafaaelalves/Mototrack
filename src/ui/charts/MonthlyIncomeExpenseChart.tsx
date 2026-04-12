import { useFont } from "@shopify/react-native-skia";
import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { CartesianChart, Line } from "victory-native";

import type { Transaction } from "@/src/domain/transaction";
import { Nunito_400Regular } from "@expo-google-fonts/nunito";

type Props = {
  year: number;
  month: number; // 1..12
  transactions: Transaction[];
};

type Datum = {
  xValue: number; // dia do mês (1..31)
  income: number; // R$
  expense: number; // R$
};

function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}

export function MonthlyIncomeExpenseChart({
  year,
  month,
  transactions,
}: Props) {
  // Importante: no Victory Native, se não passar font no axis, label pode nem renderizar.
  // (docs do CartesianChart)
  const font = useFont(Nunito_400Regular as any, 12);

  const data: Datum[] = useMemo(() => {
    const n = daysInMonth(year, month);
    const incomeCents = Array(n).fill(0);
    const expenseCents = Array(n).fill(0);

    for (const t of transactions) {
      const day = Number(t.dateISO.slice(8, 10));
      if (!Number.isFinite(day) || day < 1 || day > n) continue;

      const idx = day - 1;
      if (t.type === "income") incomeCents[idx] += t.amountCents;
      else expenseCents[idx] += t.amountCents;
    }

    // Se quiser mostrar o valor do dia, sem acumular:
    // return Array.from({ length: n }, (_, i) => ({
    //   xValue: i + 1,
    //   income: incomeCents[i] / 100,
    //   expense: expenseCents[i] / 100,
    // }));

    // Para mostrar o valor acumulado até aquele dia:
    let accIncome = 0;
    let accExpense = 0;

    return Array.from({ length: n }, (_, i) => {
      accIncome += incomeCents[i];
      accExpense += expenseCents[i];

      return {
        xValue: i + 1,
        income: accIncome / 100, // acumulado
        expense: accExpense / 100, // acumulado
      };
    });
  }, [transactions, year, month]);

  if (!font) return null;

  const hasAny = data.some((d) => d.income !== 0 || d.expense !== 0);
  if (!hasAny) {
    return (
      <View style={{ marginTop: 14 }}>
        <Text style={{ fontWeight: "800", opacity: 0.9 }}>Fluxo do mês</Text>
        <Text style={{ opacity: 0.7 }}>Sem dados para exibir o gráfico.</Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontWeight: "800", marginBottom: 10, opacity: 0.9 }}>
        Fluxo do mês
      </Text>

      <View style={{ height: 210 }}>
        <CartesianChart
          data={data}
          xKey="xValue"
          yKeys={["income", "expense"]}
          xAxis={{
            font,
            tickCount: 6,
            labelColor: "#E6E6E6", // texto do eixo X
            lineColor: "#FFFFFF33", // linha do eixo X (com alpha)
            formatXLabel: (v) => String(v),
          }}
          yAxis={[
            {
              yKeys: ["income", "expense"],
              font,
              tickCount: 5,
              labelColor: "#E6E6E6", // texto do eixo Y
              lineColor: "#FFFFFF33", // linha do eixo Y
              formatYLabel: (v) => `R$ ${v.toFixed(0)}`,
            },
          ]}
          domainPadding={{ left: 18, right: 18, top: 12, bottom: 10 }}
        >
          {({ points }) => (
            <>
              <Line points={points.income} strokeWidth={2} color="#28a745" />
              <Line points={points.expense} strokeWidth={2} color="#ff3b30" />
            </>
          )}
        </CartesianChart>
      </View>
    </View>
  );
}
