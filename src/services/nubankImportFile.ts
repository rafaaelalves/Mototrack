import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { parseNubankAccountCsv } from "../domain/nubankCsv";

const MAX_CSV_BYTES = 8 * 1024 * 1024;

/** Não guarda o CSV original: somente os campos necessários para revisão local. */
export async function selectNubankAccountCsv() {
  const selected = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (selected.canceled) return null;
  const asset = selected.assets?.[0];
  if (!asset?.uri) throw new Error("Não foi possível acessar o arquivo selecionado.");
  if (!asset.name?.toLowerCase().endsWith(".csv")) {
    throw new Error("Selecione um arquivo CSV exportado da sua conta Nubank.");
  }
  const file = new File(asset.uri);
  if (file.size <= 0 || file.size > MAX_CSV_BYTES) {
    throw new Error("Arquivo vazio ou acima do limite de 8 MB.");
  }
  const content = await file.text();
  if (content.length > MAX_CSV_BYTES) throw new Error("CSV excede o limite de tamanho.");
  return parseNubankAccountCsv(content);
}
