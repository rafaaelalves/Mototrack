import { listTransactionsByMonth, Transaction } from "@/src/db/transactions";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { ChartBarIcon, X } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function formatBRL(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatBRLValue(v: number) {
  return v.toFixed(2).replace(".", ",");
}

function monthLabelPT(year: number, month1to12: number) {
  return new Date(year, month1to12 - 1, 1).toLocaleString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function computeStats(transactions: Transaction[]) {
  let incomeCents = 0;
  let expenseCents = 0;
  let fuelCents = 0;
  let foodCents = 0;
  let kmMeters = 0;
  let maintenanceCents = 0;
  let otherCents = 0;
  let uncategorizedCents = 0;

  for (const t of transactions) {
    if (t.type === "income") {
      incomeCents += t.amountCents;
      if (typeof t.distanceMeters === "number" && t.distanceMeters > 0) {
        kmMeters += t.distanceMeters;
      }
    } else {
      expenseCents += t.amountCents;
      if (t.category === "fuel") fuelCents += t.amountCents;
      else if (t.category === "food") foodCents += t.amountCents;
      else if (t.category === "maintenance") maintenanceCents += t.amountCents;
      else if (t.category === "other") otherCents += t.amountCents;
      else uncategorizedCents += t.amountCents;
    }
  }

  const netCents = incomeCents - expenseCents;
  const km = kmMeters / 1000;

  const netPerKm = km > 0 ? netCents / 100 / km : null; // R$/km (saldo)
  const costPerKm = km > 0 ? expenseCents / 100 / km : null; // R$/km (gastos)

  return {
    incomeCents,
    expenseCents,
    netCents,
    fuelCents,
    foodCents,
    maintenanceCents,
    otherCents,
    uncategorizedCents,
    km,
    netPerKm,
    costPerKm,
  };
}

export default function Stats() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();

  // animação de entrada do card
  const [slideY] = useState(() => new Animated.Value(60));
  const [fade] = useState(() => new Animated.Value(0));

  const params = useLocalSearchParams<{ year?: string; month?: string }>();
  const now = useMemo(() => new Date(), []);
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [prevTransactions, setPrevTransactions] = useState<Transaction[]>([]);

  const [page, setPage] = useState(0);
  const [pagerWidth, setPagerWidth] = useState(0);

  function onPagerLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    if (w && w !== pagerWidth) setPagerWidth(w);
  }

  const load = useCallback(async () => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;

    //Mês atual
    const items = await listTransactionsByMonth(db, year, month);
    setTransactions(items);

    //Mês anterior
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevItems = await listTransactionsByMonth(db, prevYear, prevMonth);
    setPrevTransactions(prevItems);
  }, [db, year, month]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideY, fade]);

  useEffect(() => {
    load();
  }, [load]);

  //stats do mes atual + mes anterior
  const currentStats = useMemo(
    () => computeStats(transactions),
    [transactions]
  );
  const previousStats = useMemo(
    () => computeStats(prevTransactions),
    [prevTransactions]
  );

  //Projeção até o fim do mes
  const projection = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const isCurrentMonth =
      now.getFullYear() === year && now.getMonth() + 1 === month;

    // Se for mês atual, usamos o dia de hoje; senão, usamos o total de dias (mês passado ou futuro)
    const currentDay = isCurrentMonth ? now.getDate() : daysInMonth;
    const safeDay = Math.max(1, Math.min(currentDay, daysInMonth));

    const avgIncomePerDayCents = currentStats.incomeCents / safeDay;
    const avgExpensePerDayCents = currentStats.expenseCents / safeDay;
    const avgNetPerDayCents = currentStats.netCents / safeDay;

    const projectedIncomeCents = Math.round(avgIncomePerDayCents * daysInMonth);
    const projectedExpenseCents = Math.round(
      avgExpensePerDayCents * daysInMonth
    );
    const projectedNetCents = Math.round(avgNetPerDayCents * daysInMonth);

    return {
      daysInMonth,
      currentDay: safeDay,
      projectedIncomeCents,
      projectedExpenseCents,
      projectedNetCents,
    };
  }, [currentStats, year, month, now]);

  // Diferença de saldo vs mes anterior
  const netDiffCents = currentStats.netCents - previousStats.netCents;
  const fuelDiffCents = currentStats.fuelCents - previousStats.fuelCents;
  const foodDiffCents = currentStats.foodCents - previousStats.foodCents;

  const title =
    Number.isFinite(year) && Number.isFinite(month)
      ? monthLabelPT(year, month)
      : "Estatísticas";

  const hasData = transactions.length > 0;
  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={() => router.back()} />

      <Animated.View
        style={[
          styles.container,
          {
            paddingBottom: insets.bottom + 16,
            opacity: fade,
            transform: [{ translateY: slideY }],
          },
        ]}
      >
        <View style={styles.topRow}>
          <View style={styles.titleRow}>
            <ChartBarIcon
              size={20}
              weight="duotone"
              color="rgba(255,255,255,0.90)"
            />
            <Text style={styles.title}>{title}</Text>
          </View>

          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <X size={20} weight="bold" color="rgba(255,255,255,0.90)" />
          </Pressable>
        </View>

        {!hasData ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Sem dados neste mês</Text>
            <Text style={styles.emptySubtitle}>
              Adicione alguns lançamentos para ver comparações e projeções aqui.
            </Text>
          </View>
        ) : (
          <>
            <View onLayout={onPagerLayout}>
              {pagerWidth > 0 && (
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const x = e.nativeEvent.contentOffset.x;
                    const p = Math.round(x / pagerWidth);
                    setPage(p);
                  }}
                >
                  {/* PAGE 1 - Comparação + Projeção */}
                  <View style={{ width: pagerWidth }}>
                    <View style={styles.grid}>
                      <View style={styles.card}>
                        <Text style={styles.label}>Saldo (mês atual)</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.netCents)}
                        </Text>
                      </View>

                      <View style={styles.card}>
                        <Text style={styles.label}>Saldo (mês anterior)</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(previousStats.netCents)}
                        </Text>
                      </View>

                      <View style={[styles.card, { flexBasis: "100%" }]}>
                        <Text style={styles.label}>Diferença de Saldo</Text>
                        <Text
                          style={[
                            styles.value,
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
                                Math.abs(netDiffCents)
                              )}`}
                        </Text>
                      </View>

                      <View style={styles.card}>
                        <Text style={styles.label}>Combustivel (atual)</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.fuelCents)}
                        </Text>
                        <Text style={styles.subLabel}>
                          Anterior: R$ {formatBRL(previousStats.fuelCents)}
                        </Text>
                        <Text
                          style={[
                            styles.diffText,
                            fuelDiffCents > 0
                              ? styles.negative
                              : fuelDiffCents < 0
                              ? styles.positive
                              : null,
                          ]}
                        >
                          {fuelDiffCents === 0
                            ? "Igual ao mês anterior"
                            : fuelDiffCents > 0
                            ? `+R$ ${formatBRL(fuelDiffCents)} em gastos`
                            : `-R$ ${formatBRL(
                                Math.abs(fuelDiffCents)
                              )} em gastos`}
                        </Text>
                      </View>

                      <View style={styles.card}>
                        <Text style={styles.label}>Alimentação (atual)</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.foodCents)}
                        </Text>
                        <Text style={styles.subLabel}>
                          Anterior: R$ {formatBRL(previousStats.foodCents)}
                        </Text>
                        <Text
                          style={[
                            styles.diffText,
                            foodDiffCents > 0
                              ? styles.negative
                              : foodDiffCents < 0
                              ? styles.positive
                              : null,
                          ]}
                        >
                          {foodDiffCents === 0
                            ? "Igual ao mês anterior"
                            : foodDiffCents > 0
                            ? `+R$ ${formatBRL(foodDiffCents)} em gastos`
                            : `-R$ ${formatBRL(
                                Math.abs(foodDiffCents)
                              )} em gastos`}
                        </Text>
                      </View>

                      <View style={[styles.card, { flexBasis: "100%" }]}>
                        <Text style={styles.label}>
                          Projeção até o fim do mês
                        </Text>
                        <Text style={styles.projLine}>
                          Entradas {""}
                          <Text style={styles.valueInLine}>
                            R$ {formatBRL(projection.projectedIncomeCents)}
                          </Text>
                        </Text>
                        <Text style={styles.projLine}>
                          Saídas {""}
                          <Text style={styles.valueInLine}>
                            R$ {formatBRL(projection.projectedExpenseCents)}
                          </Text>
                        </Text>
                        <Text style={styles.projLine}>
                          Saldo projetado: {""}
                          <Text
                            style={[
                              styles.valueInLine,
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
                    </View>
                  </View>

                  {/* PAGE 2 - Categorias */}
                  <View style={{ width: pagerWidth }}>
                    <View style={styles.grid}>
                      <View style={styles.card}>
                        <Text style={styles.label}>Combustível</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.fuelCents)}
                        </Text>
                      </View>

                      <View style={styles.card}>
                        <Text style={styles.label}>Alimentação</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.foodCents)}
                        </Text>
                      </View>

                      <View style={styles.card}>
                        <Text style={styles.label}>Manutenção</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.maintenanceCents)}
                        </Text>
                      </View>

                      <View style={styles.card}>
                        <Text style={styles.label}>Outros</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.otherCents)}
                        </Text>
                      </View>

                      <View style={[styles.card, { flexBasis: "100%" }]}>
                        <Text style={styles.label}>Sem categoria</Text>
                        <Text style={styles.value}>
                          R$ {formatBRL(currentStats.uncategorizedCents)}
                        </Text>
                      </View>
                      <View style={styles.card}>
                        <Text style={styles.label}>KM no mês</Text>
                        <Text style={styles.value}>
                          {currentStats.km.toFixed(1).replace(".", ",")} km
                        </Text>
                      </View>

                      <View style={styles.card}>
                        <Text style={styles.label}>Custo por KM</Text>
                        <Text style={styles.value}>
                          {currentStats.costPerKm === null
                            ? "—"
                            : `R$ ${formatBRLValue(currentStats.costPerKm)}`}
                        </Text>
                      </View>

                      <View style={[styles.card, { flexBasis: "100%" }]}>
                        <Text style={styles.label}>R$/km (saldo)</Text>
                        <Text style={styles.value}>
                          {currentStats.netPerKm === null
                            ? "—"
                            : `R$ ${currentStats.netPerKm
                                .toFixed(2)
                                .replace(".", ",")}`}
                        </Text>
                        <Text style={styles.hint}>
                          Se não houver KM preenchido em ganhos, fica “—”.
                        </Text>
                      </View>
                    </View>
                  </View>
                </ScrollView>
              )}
            </View>

            <View style={styles.dots}>
              <View style={[styles.dot, page === 0 && styles.dotActive]} />
              <View style={[styles.dot, page === 1 && styles.dotActive]} />
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  container: {
    backgroundColor: "rgba(10,10,26,0.96)",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    textTransform: "capitalize",
    color: "rgba(255,255,255,0.90)",
  },
  iconBtn: {
    padding: 8,
  },

  // 🔹 ESTADO VAZIO (NOVO)
  emptyContainer: {
    paddingVertical: 32,
    paddingHorizontal: 12,
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
    color: "rgba(255,255,255,0.70)",
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  card: {
    flexBasis: "48%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  label: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 6,
    color: "rgba(255,255,255,0.70)",
  },
  subLabel: {
    fontSize: 11,
    marginTop: 4,
    color: "rgba(255,255,255,0.60)",
  },
  value: {
    fontSize: 14,
    fontWeight: "800",
    color: "rgba(255,255,255,0.95)",
  },
  valueInLine: {
    fontSize: 14,
    fontWeight: "800",
    color: "rgba(255,255,255,0.95)",
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    opacity: 0.6,
    color: "rgba(255,255,255,0.70)",
  },
  diffText: {
    marginTop: 4,
    fontSize: 12,
  },
  projLine: {
    fontSize: 13,
    marginTop: 2,
    color: "rgba(255,255,255,0.85)",
  },
  positive: {
    color: "#28a745",
  },
  negative: {
    color: "#ff3b30",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  dotActive: {
    backgroundColor: "#FFB35A",
  },
});
