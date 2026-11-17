import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SQLiteDatabase } from "expo-sqlite";
import { Alert } from "react-native";
import { applyBackup, buildBackup, type BackupFile } from "../db/backup";
import { parseBackupFile } from "../domain/backupValidation";

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

function backupFileName(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  return `mototrack-${prefix}-${date}-${now.getTime()}.json`;
}

async function saveLocalBackup(
  backup: BackupFile,
  prefix: string,
): Promise<File> {
  const dir = new Directory(Paths.document, "backups");
  await dir.create({ intermediates: true, idempotent: true });

  const file = new File(dir, backupFileName(prefix));
  const json = JSON.stringify(backup, null, 2);

  // Não sobrescrever um backup existente por engano.
  file.create({ intermediates: true, overwrite: false });
  file.write(json);

  // Verificação simples de gravação antes de oferecer restaurar dados.
  const readBack = await file.text();
  if (readBack !== json) {
    throw new Error("A cópia de segurança não pôde ser verificada.");
  }
  return file;
}

export async function exportBackup(db: SQLiteDatabase) {
  try {
    const file = await saveLocalBackup(await buildBackup(db), "backup");
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Exportar backup do Mototrack",
      });
    } else {
      Alert.alert(
        "Backup gerado",
        `Arquivo salvo em:\n${file.uri}\n\nGuarde outra cópia fora do aparelho.`,
      );
    }
  } catch (error: unknown) {
    console.error(error);
    Alert.alert("Erro ao exportar", errorMessage(error));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

function readableDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("pt-BR");
}

export async function importBackupFromFile(db: SQLiteDatabase) {
  try {
    const selected = await DocumentPicker.getDocumentAsync({
      type: "application/json",
      copyToCacheDirectory: true,
    });
    if (selected.canceled) return;

    const asset = selected.assets?.[0];
    if (!asset?.uri) {
      Alert.alert("Arquivo inválido", "Não foi possível ler o arquivo selecionado.");
      return;
    }

    const file = new File(asset.uri);
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error("Arquivo muito grande para importação segura.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("O arquivo escolhido não é um JSON válido.");
    }

    // Validação completa de todos os registros antes de abrir confirmação.
    const backup = parseBackupFile(parsed);
    const current = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM transactions;",
    );
    const currentCount = current?.count ?? 0;

    if (backup.transactions.length === 0 && currentCount > 0) {
      throw new Error(
        "O arquivo está vazio. Para proteger seus lançamentos, não é possível usá-lo para apagar o banco.",
      );
    }

    Alert.alert(
      "Confirmar restauração",
      `Backup de ${readableDate(backup.exportedAt)} com ${backup.transactions.length} lançamentos, ${backup.bankImportRows.length} movimentações de extrato e ${backup.bankImportRules.length} regras.\n\nAtualmente há ${currentCount} lançamentos (incluindo excluídos).\n\n${backup.version === 1 ? "Atenção: backup antigo v1 não contém fila de extratos ou regras. " : ""}Uma cópia local de recuperação v2 será salva e verificada antes de substituir os dados. Deseja continuar?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Criar cópia e restaurar",
          style: "destructive",
          onPress: async () => {
            try {
              const recovery = await saveLocalBackup(
                await buildBackup(db),
                "antes-de-restaurar",
              );

              // Se não foi possível salvar/verificar a cópia, nunca começa
              // a substituição. No SQLite, falhas de escrita fazem rollback.
              await applyBackup(db, backup);

              Alert.alert(
                "Restauração concluída",
                `Os dados foram importados.\n\nCópia anterior preservada em:\n${recovery.uri}\n\nRecomendamos guardar também uma cópia fora do aparelho.`,
              );
            } catch (error: unknown) {
              console.error(error);
              Alert.alert(
                "Restauração não concluída",
                `${errorMessage(error)}\n\nVerifique os dados e a pasta de backups antes de tentar novamente.`,
              );
            }
          },
        },
      ],
    );
  } catch (error: unknown) {
    console.error(error);
    Alert.alert("Backup rejeitado", errorMessage(error));
  }
}
