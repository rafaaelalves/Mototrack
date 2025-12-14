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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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

export default function NewEntry() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEditing = Number.isFinite(editingId) && editingId !== null;

  const [type, setType] = useState<"income" | "expense">("income");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const [selectedDate, setSelectedDate] = useState(new Date()); // Data atual
  const [showPicker, setShowPicker] = useState(false);
  const dateISO = toISODate(selectedDate);

  const cleaned = amount.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  const cents = Number.isFinite(n) ? Math.round(n * 100) : 0;
  const canSave = title.trim().length > 0 && cents > 0;

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    setShowPicker(false);
    if (date) setSelectedDate(date);
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
    })();
  }, [db, isEditing, editingId]);

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

    const payload = {
      dateISO,
      type,
      amountCents: cents,
      title: title.trim(),
      notes: notes.trim() ? notes.trim() : null,
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
        style={[styles.container, { paddingBottom: insets.bottom + 20 }]}
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 15 }}>
          <Pressable
            style={[
              styles.input,
              { flex: 1, alignItems: "center" },
              type === "income" && { borderColor: "#000" },
            ]}
            onPress={() => setType("income")}
          >
            <Text>Entrada</Text>
          </Pressable>

          <Pressable
            style={[
              styles.input,
              { flex: 1, alignItems: "center" },
              type === "expense" && { borderColor: "#000" },
            ]}
            onPress={() => setType("expense")}
          >
            <Text>Saída</Text>
          </Pressable>
        </View>
        <View style={styles.formGroup}>
          <>
            <Text>Data</Text>
            <Pressable
              onPress={() => setShowPicker(true)}
              style={[styles.input, { justifyContent: "center", height: 45 }]}
            >
              <Text>{dateISO}</Text>
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
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            style={styles.input}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Nome da transação</Text>
          <TextInput
            placeholder="Ex: Salário, Mercado..."
            value={title}
            onChangeText={setTitle}
            style={[styles.input]}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Descrição</Text>
          <TextInput
            multiline
            placeholder="Notas adicionais (opcional)"
            value={notes}
            onChangeText={setNotes}
            style={[styles.input, styles.textarea]}
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
  container: {
    padding: 20,
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "80%",
  },
  formGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    marginBottom: 5,
    fontWeight: "500",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textarea: {
    height: 80,
    textAlignVertical: "top",
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
});
