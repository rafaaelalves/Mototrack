import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SQLiteDatabase } from "expo-sqlite";
import { Alert } from "react-native";
import { applyBackup, buildBackup, type BackupFile } from "../db/backup";

function backupFileName() {
  // AAAA-MM-DD + HHmmss pra evitar colisão (2 backups no mesmo dia)
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const time = `${String(d.getHours()).padStart(2, "0")}${String(
    d.getMinutes()
  ).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  return `mototrack-backup-${date}-${time}.json`;
}

export async function exportBackup(db: SQLiteDatabase) {
  try {
    const backup = await buildBackup(db);
    const json = JSON.stringify(backup, null, 2);

    // (opcional, mas organizado) /document/backups
    const backupsDir = new Directory(Paths.document, "backups");
    backupsDir.create({ intermediates: true, idempotent: true }); // cria a pasta se precisar :contentReference[oaicite:5]{index=5}

    const fileName = backupFileName();
    const file = new File(backupsDir, fileName);

    // cria o arquivo e sobrescreve se existir (por segurança)
    file.create({ intermediates: true, overwrite: true }); // :contentReference[oaicite:6]{index=6}
    file.write(json); // escreve o conteúdo :contentReference[oaicite:7]{index=7}

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Exportar backup do Mototrack",
        // (se quiser caprichar no iOS depois, dá pra usar UTI também) :contentReference[oaicite:8]{index=8}
      });
    } else {
      Alert.alert(
        "Backup gerado",
        `Arquivo criado em:\n${file.uri}\n\nDica: em geral o jeito mais confiável é usar o botão de compartilhar quando disponível.`
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
      copyToCacheDirectory: true, // importante pro FileSystem ler imediatamente :contentReference[oaicite:9]{index=9}
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      Alert.alert("Erro", "Não foi possível ler o arquivo selecionado.");
      return;
    }

    // ✅ Evita o erro do TS: DocumentPickerAsset -> usamos a URI (string)
    const file = new File(asset.uri);
    const content = await file.text(); // lê texto :contentReference[oaicite:10]{index=10}

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      Alert.alert("Arquivo inválido", "O arquivo não é um JSON válido.");
      return;
    }

    // validação mínima do formato do backup
    const maybe = parsed as Partial<BackupFile>;
    if (
      !maybe ||
      typeof maybe !== "object" ||
      maybe.version !== 1 ||
      !Array.isArray(maybe.transactions)
    ) {
      Alert.alert(
        "Backup incompatível",
        "O arquivo não parece ser um backup do Mototrack (versão 1)."
      );
      return;
    }

    const backup = maybe as BackupFile;

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
