// app/settings.tsx
import { exportBackup, importBackupFromFile } from "@/src/services/backupFile";
import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { GearSix, X } from "phosphor-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function Settings() {
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <GearSix size={22} weight="duotone" color="rgba(255,255,255,0.9)" />
          <Text style={styles.title}>Configurações</Text>
        </View>

        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <X size={20} weight="bold" color="rgba(255,255,255,0.9)" />
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup local</Text>
        <Text style={styles.sectionSubtitle}>
          Exporte um arquivo .json com todos seus lançamentos ou importe um
          backup existente.
        </Text>

        <Pressable style={styles.primaryBtn} onPress={() => exportBackup(db)}>
          <Text style={styles.primaryBtnText}>Exportar backup</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryBtn}
          onPress={() => importBackupFromFile(db)}
        >
          <Text style={styles.secondaryBtnText}>Importar backup</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sincronização em nuvem</Text>
        <Text style={styles.sectionSubtitle}>
          Em versões futuras, você poderá conectar sua conta (como Google Drive)
          para salvar o backup automaticamente na nuvem.
        </Text>
        <View style={styles.disabledBox}>
          <Text style={styles.disabledText}>Em breve</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Mototrack • v0.2 (dev)</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(10,10,26,1)",
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "rgba(255,255,255,0.95)",
  },
  iconBtn: {
    padding: 8,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: "#28a745",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  secondaryBtn: {
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  secondaryBtnText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "500",
  },
  disabledBox: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
  },
  disabledText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
  },
  footer: {
    marginTop: "auto",
    padding: 16,
    alignItems: "center",
  },
  footerText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
});
