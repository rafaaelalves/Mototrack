import {
  getTransactionById,
  insertTransaction,
  updateTransaction,
} from "@/src/db/transactions";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Converte uma data do formato dd/mm/aaaa para yyyy-mm-dd
function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromISODate(iso: string) {
  const [yyyy, mm, dd] = iso.split("-").map(Number);
  return new Date(yyyy, (mm ?? 1) - 1, dd ?? 1);
}

function parseMoneyToCents(text: string) {
  const raw = text.trim();
  if (!raw) return 0;

  // mantém só dígitos e separadores
  const s = raw.replace(/[^\d.,]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const hasSep = lastComma !== -1 || lastDot !== -1;

  // considera o ÚLTIMO separador como decimal; o resto vira milhar e é removido
  if (hasSep) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const idx = s.lastIndexOf(decimalSep);

    const intPart = s.slice(0, idx).replace(/[.,]/g, "");
    const fracPart = s.slice(idx + 1).replace(/[.,]/g, "");

    const normalized = `${intPart}.${fracPart}`;
    const n = Number(normalized);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  // sem separador, é inteiro
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const CATEGORIES = [
  { key: "fuel", label: "Combustível" },
  { key: "food", label: "Alimentação" },
  { key: "maintenance", label: "Manutenção" },
  { key: "other", label: "Outros" },
] as const;

export default function NewEntry() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();

  // animação de entrada do card
  const [slideY] = useState(() => new Animated.Value(60));
  const [fade] = useState(() => new Animated.Value(0));

  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEditing = Number.isFinite(editingId) && editingId !== null;

  const [type, setType] = useState<"income" | "expense">("income");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [km, setKm] = useState(""); // string porque vem do TextInput

  const [selectedDate, setSelectedDate] = useState(new Date()); // Data atual
  const [showPicker, setShowPicker] = useState(false);
  const dateISO = toISODate(selectedDate);

  const cents = parseMoneyToCents(amount);
  const canSave = title.trim().length > 0 && cents > 0;

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    setShowPicker(false);
    if (date) setSelectedDate(date);
  }

  function kmToMeters(text: string) {
    //aceita "12,5" ou "12.5"
    const cleaned = text.trim().replace(",", ".");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 1000);
  }

  useEffect(() => {
    if (!isEditing) return;

    (async () => {
      const tx = await getTransactionById(db, editingId!);
      if (!tx) return;

      setType(tx.type);
      setTitle(tx.title);
      setNotes(tx.notes ?? "");
      setAmount((tx.amountCents / 100).toFixed(2).replace(".", ","));
      setSelectedDate(fromISODate(tx.dateISO));
      setCategory(tx.category ?? null);

      const kmValue = tx.distanceMeters
        ? (tx.distanceMeters / 1000).toFixed(1).replace(".", ",")
        : "";
      setKm(kmValue);
    })();
  }, [db, isEditing, editingId]);

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

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert("Erro", "Por favor, insira um título para a transação.");
      return;
    }
    if (!amount.trim() || cents <= 0) {
      Alert.alert(
        "Erro",
        "Por favor, insira um valor válido (maior que zero)."
      );
      return;
    }

    const distanceMeters = kmToMeters(km);
    const payload = {
      dateISO,
      type,
      amountCents: cents,
      title: title.trim(),
      notes: notes.trim() ? notes.trim() : null,
      category: type === "expense" ? category : null,
      distanceMeters: type === "income" ? distanceMeters : null,
    };

    if (isEditing) {
      await updateTransaction(db, editingId!, payload);
    } else {
      await insertTransaction(db, payload);
    }

    router.back();
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={() => router.back()} />

      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View
          style={[
            styles.container,
            {
              paddingBottom: insets.bottom + 12,
              transform: [{ translateY: slideY }], //anima a subida
            },
          ]}
        >
          <KeyboardAwareScrollView
            enableOnAndroid
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            extraScrollHeight={16}
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 15 }}>
              <Pressable
                style={[
                  styles.input,
                  { flex: 1, alignItems: "center" },
                  type === "income" && {
                    borderColor: "#FFB35A",
                    backgroundColor: "rgba(255,179,90,0.18)",
                  },
                ]}
                onPress={() => {
                  setType("income");
                  setCategory(null); // limpa categoria (não faz sentido em income)
                }}
              >
                <Text style={styles.toggleText}>Entrada</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.input,
                  { flex: 1, alignItems: "center" },
                  type === "expense" && {
                    borderColor: "#FFB35A",
                    backgroundColor: "rgba(255,179,90,0.18)",
                  },
                ]}
                onPress={() => {
                  setType("expense");
                  setKm(""); // limpa km (não faz sentido em expense)
                  if (!category) setCategory("other");
                }}
              >
                <Text style={styles.toggleText}>Saída</Text>
              </Pressable>
            </View>
            <View style={styles.formGroup}>
              <>
                <Text style={styles.label}>Data</Text>
                <Pressable
                  onPress={() => setShowPicker(true)}
                  style={[
                    styles.input,
                    { justifyContent: "center", height: 45 },
                  ]}
                >
                  <Text style={styles.dateText}>{dateISO}</Text>
                </Pressable>
                {showPicker && (
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    onChange={onChangeDate}
                  />
                )}
              </>
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Valor da transação R$</Text>
              <TextInput
                placeholder="0,00"
                keyboardType={Platform.select({
                  ios: "decimal-pad",
                  android: "numeric",
                })}
                value={amount}
                onChangeText={setAmount}
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
            </View>
            {type === "income" && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>KM rodados (opcional)</Text>
                <TextInput
                  placeholder="Ex: 23,5"
                  keyboardType="numeric"
                  value={km}
                  onChangeText={setKm}
                  style={styles.input}
                  placeholderTextColor="rgba(255,255,255,0.45)"
                />
              </View>
            )}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Nome da transação</Text>
              <TextInput
                placeholder="Ex: Salário, Mercado..."
                value={title}
                onChangeText={setTitle}
                style={[styles.input]}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
            </View>
            {type === "expense" && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>Categoria</Text>

                <View style={styles.chipsRow}>
                  {CATEGORIES.map((c) => {
                    const selected = category === c.key;
                    return (
                      <Pressable
                        key={c.key}
                        onPress={() => setCategory(selected ? null : c.key)}
                        style={[styles.chip, selected && styles.chipSelected]}
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

                <Text style={styles.helperText}>
                  (Opcional) Ajuda nas estatísticas do mês.
                </Text>
              </View>
            )}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Descrição</Text>
              <TextInput
                multiline
                placeholder="Notas adicionais (opcional)"
                value={notes}
                onChangeText={setNotes}
                style={[styles.input, styles.textarea]}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
            </View>
            <Pressable
              style={[styles.saveButton, !canSave && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={styles.saveButtonText}>
                {isEditing ? "Salvar Alterações" : "Salvar"}
              </Text>
            </Pressable>
          </KeyboardAwareScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  kav: {
    flex: 1,
    justifyContent: "flex-end",
  },
  container: {
    padding: 20,
    backgroundColor: "rgba(10,10,26,0.96)",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    maxHeight: "80%",
  },
  formGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    marginBottom: 5,
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
  },
  dateText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 16,
    fontFamily: "Nunito_400Regular",
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "rgba(255,255,255,0.95)",
  },
  textarea: {
    height: 80,
    textAlignVertical: "top",
  },
  toggleText: {
    color: "rgba(255,255,255,0.95)",
  },
  saveButton: {
    marginTop: 20,
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#28a745",
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipSelected: {
    borderColor: "#FFB35A",
    backgroundColor: "rgba(255,179,90,0.18)",
  },
  chipText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.80)",
  },
  chipTextSelected: {
    fontWeight: "700",
  },
  helperText: {
    marginTop: 6,
    fontSize: 12,
    opacity: 0.7,
    color: "rgba(255,255,255,0.70)",
  },
});
