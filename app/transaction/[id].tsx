import {
  deleteTransaction,
  getTransactionById,
  Transaction,
} from "@/src/db/transactions";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  CalendarBlank,
  MinusCircle,
  Note,
  PencilSimple,
  PlusCircle,
  RoadHorizon,
  Tag,
  TrashSimple,
  X,
} from "phosphor-react-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function formatBRL(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatDateBR(iso: string) {
  // iso esperado: yyyy-mm-dd
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function categoryLabel(key: string | null) {
  switch (key) {
    case "fuel":
      return "Combustível";
    case "food":
      return "Alimentação";
    case "maintenance":
      return "Manutenção";
    case "other":
      return "Outros";
    default:
      return null;
  }
}

export default function TransactionDetails() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : NaN;

  const [tx, setTx] = useState<Transaction | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    (async () => {
      const row = await getTransactionById(db, id);
      setTx(row);
    })();
  }, [db, id]);

  const header = useMemo(() => {
    if (!tx) return null;

    const isIncome = tx.type === "income";
    const sign = isIncome ? "+" : "-";
    const label = isIncome ? "Entrada" : "Saída";

    return { isIncome, sign, label };
  }, [tx]);

  async function handleDelete() {
    if (!tx) return;

    Alert.alert("Excluir lançamento?", "Essa ação não pode ser desfeita.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          await deleteTransaction(db, tx.id);
          router.back();
        },
      },
    ]);
  }

  function handleEdit() {
    if (!tx) return;
    router.push({
      pathname: "/newEntry",
      params: { id: String(tx.id) },
    });
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={() => router.back()} />

      <View style={[styles.card, { marginBottom: insets.bottom + 12 }]}>
        <View style={styles.topRow}>
          <View style={styles.titleRow}>
            {header?.isIncome ? (
              <PlusCircle size={22} weight="duotone" color="#28a745" />
            ) : (
              <MinusCircle size={22} weight="duotone" color="#ff3b30" />
            )}
            <Text style={styles.titleText}>
              {tx ? tx.title : "Carregando..."}
            </Text>
          </View>

          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <X size={20} weight="bold" color="rgba(255,255,255,0.90)" />
          </Pressable>
        </View>

        {tx ? (
          <>
            <View style={styles.amountRow}>
              <Text style={styles.amount}>
                R$ {header?.sign} {formatBRL(tx.amountCents)}
              </Text>
              <Text style={styles.badge}>{header?.label}</Text>
            </View>

            <View style={styles.metaRow}>
              <CalendarBlank
                size={18}
                weight="duotone"
                color="rgba(255,255,255,0.90)"
              />
              <Text style={styles.metaText}>{formatDateBR(tx.dateISO)}</Text>
            </View>

            {tx.type === "expense" && categoryLabel(tx.category) ? (
              <View style={styles.metaRow}>
                <Tag
                  size={18}
                  weight="duotone"
                  color="rgba(255,255,255,0.90)"
                />
                <Text style={styles.metaText}>
                  {categoryLabel(tx.category)}
                </Text>
              </View>
            ) : null}

            {tx.type === "income" &&
            typeof tx.distanceMeters === "number" &&
            tx.distanceMeters > 0 ? (
              <View style={styles.metaRow}>
                <RoadHorizon
                  size={18}
                  weight="duotone"
                  color="rgba(255,255,255,0.90)"
                />
                <Text style={styles.metaText}>
                  {(tx.distanceMeters / 1000).toFixed(1).replace(".", ",")} km
                </Text>
              </View>
            ) : null}

            {tx.notes ? (
              <View style={styles.notesBox}>
                <View style={styles.metaRow}>
                  <Note
                    size={18}
                    weight="duotone"
                    color="rgba(255,255,255,0.90)"
                  />
                  <Text style={[styles.metaText, { fontWeight: "700" }]}>
                    Descrição
                  </Text>
                </View>
                <Text style={styles.notesText}>{tx.notes}</Text>
              </View>
            ) : null}

            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.actionBtn, styles.editBtn]}
                onPress={handleEdit}
              >
                <PencilSimple size={18} weight="duotone" color="#000" />
                <Text style={styles.actionText}>Editar</Text>
              </Pressable>

              <Pressable
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={handleDelete}
              >
                <TrashSimple size={18} weight="duotone" color="#ff3b30" />
                <Text style={[styles.actionText, { color: "#ff3b30" }]}>
                  Excluir
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={{ opacity: 0.7, marginTop: 8 }}>
            Carregando dados...
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  card: {
    backgroundColor: "rgba(10,10,26,0.96)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  titleText: {
    fontSize: 16,
    fontWeight: "800",
    flexShrink: 1,
    color: "rgba(255,255,255,0.90)",
  },
  iconBtn: {
    padding: 8,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  amount: {
    fontSize: 18,
    fontWeight: "900",
    color: "rgba(255,255,255,0.90)",
  },
  badge: {
    fontSize: 12,
    opacity: 0.7,
    borderWidth: 1,
    borderColor: "#FFB35A",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    color: "rgba(255,255,255,0.90)",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  metaText: {
    fontSize: 14,
    opacity: 0.85,
    color: "rgba(255,255,255,0.90)",
  },
  notesBox: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  notesText: {
    marginTop: 8,
    fontSize: 14,
    opacity: 0.85,
    lineHeight: 20,
    color: "rgba(255,255,255,0.90)",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  editBtn: {
    backgroundColor: "#fff",
  },
  deleteBtn: {
    backgroundColor: "#fff",
  },
  actionText: {
    fontSize: 14,
    fontWeight: "800",
  },
});
