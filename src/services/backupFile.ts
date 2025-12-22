import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SQLiteDatabase } from "expo-sqlite";
import { Alert } from "react-native";
import { applyBackup, buildBackup, type BackupFile } from "../db/backup";

export async function exportBackup(db: SQLiteDatabase) {
  try {
    const backup = await buildBackup(db);
    const json = JSON.stringify(backup, null, 2);

    const date = new Date().toISOString().slice(0, 10);
    const fileName = `mototrack-backup-${date}.json`;

    const fsAny = FileSystem as any;
    const dir: string | null =
      fsAny.cacheDirectory ?? fsAny.documentDirectory ?? null;

    if (!dir) {
      Alert.alert(
        "Erro",
        "Não foi possível acessar o diretório de arquivos do app."
      );
      return;
    }

    const fileUri = dir + fileName;

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        dialogTitle: "Exportar backup do Mototrack",
      });
    } else {
      Alert.alert(
        "Backup gerado",
        `Arquivo criado em:\n${fileUri}\n\nUse um gerenciador de arquivos para enviar para a nuvem.`
      );
    }
  } catch (err: any) {
    console.error(err);
    Alert.alert(
      "Erro ao exportar backup",
      err?.message ?? "Tente novamente mais tarde."
    );
  }
}

export async function importBackupFromFile(db: SQLiteDatabase) {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/json",
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      Alert.alert(
        "Erro",
        "Não foi possível ler o arquivo selecionado. Tente novamente."
      );
      return;
    }

    const content = await FileSystem.readAsStringAsync(asset.uri);

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      Alert.alert("Arquivo inválido", "O arquivo não é um JSON válido.");
      return;
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.transactions)
    ) {
      Alert.alert(
        "Backup incompatível",
        "O arquivo não parece ser um backup do Mototrack (Versão 1)."
      );
      return;
    }

    const backup = parsed as BackupFile;

    Alert.alert(
      "Confirmar restauração",
      "Isso vai substituir os dados atuais pelos do backup. Deseja continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Restaurar",
          style: "destructive",
          onPress: async () => {
            try {
              await applyBackup(db, backup);
              Alert.alert(
                "Backup restaurado",
                "Os dados foram importados com sucesso."
              );
            } catch (err: any) {
              console.error(err);
              Alert.alert(
                "Erro ao restaurar backup",
                err?.message ?? "Tente novamente mais tarde."
              );
            }
          },
        },
      ]
    );
  } catch (err: any) {
    console.error(err);
    Alert.alert(
      "Erro ao importar backup",
      err?.message ?? "Tente novamente mais tarde."
    );
  }
}
