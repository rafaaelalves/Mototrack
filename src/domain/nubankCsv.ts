import type { ExpenseCategory, IncomeCategory } from "./categories";
import type { TransactionType } from "./transaction";

export type ImportAction = "import" | "ignore" | "transfer";
export type ImportStatus = "pending" | "imported" | "ignored" | "transfer" | "merged";
export type NubankAccountRow = {
  sourceId: string;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  description: string;
  merchantKey: string;
  suggestedCategory: ExpenseCategory | IncomeCategory | null;
  suggestedAction: ImportAction | null;
};
export const NUBANK_ACCOUNT_SOURCE = "nubank-account";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}
function safeDisplay(value: string): string {
  return value.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\b/g, "")
    .replace(/•••\.\d{3}\.\d{3}-••/g, "")
    .replace(/\b(?:Ag[eê]ncia|Conta)\s*:\s*[\d.-]+/gi, "")
    .replace(/\s+/g, " ").replace(/^[\s-]+|[\s-]+$/g, "").slice(0, 180);
}
type CsvRecord = { fields: string[]; line: number };

/** Suporta CSV RFC4180: aspas duplicadas, linhas entre aspas, CRLF e BOM. */
export function parseCsvRecords(text: string): CsvRecord[] {
  const input = text.replace(/^\uFEFF/, "");
  const records: CsvRecord[] = [];
  let fields: string[] = [], field = "", quoted = false, quoteClosed = false;
  let line = 1, recordLine = 1;
  function addField() {
    fields.push(field); field = ""; quoteClosed = false;
  }
  function addRecord() {
    addField();
    if (!(fields.length === 1 && fields[0] === "")) {
      records.push({ fields, line: recordLine });
      if (records.length > 20_001) throw new Error("O CSV excede 20 mil lançamentos.");
    }
    fields = []; recordLine = line + 1;
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; quoteClosed = true; }
      } else { field += ch; if (ch === "\n") line++; }
    } else if (ch === "," || ch === "\n" || ch === "\r") {
      if (ch === ",") addField();
      else { if (ch === "\r" && input[i + 1] === "\n") i++; addRecord(); line++; }
    } else if (ch === '"' && field === "" && !quoteClosed) quoted = true;
    else if (quoteClosed && ch === " ") { /* espaço externo */ }
    else if (ch === '"' || quoteClosed) {
      throw new Error("Aspas inválidas no CSV, linha " + line + ".");
    } else field += ch;
    if (field.length > 15_000) throw new Error("Campo excessivo na linha " + line + ".");
  }
  if (quoted) throw new Error("O CSV contém aspas não fechadas.");
  if (field !== "" || fields.length > 0 || quoteClosed) addRecord();
  return records;
}

function parseDateBr(value: string, line: number): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error("Data inválida na linha " + line + ". Use DD/MM/AAAA.");
  const [_, dd, mm, yyyy] = match;
  const year = Number(yyyy), iso = yyyy + "-" + mm + "-" + dd;
  const date = new Date(iso + "T00:00:00.000Z");
  if (year < 2000 || year > 2100 || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== iso) {
    throw new Error("Data inexistente na linha " + line + ".");
  }
  return iso;
}
function parseAmount(value: string, line: number) {
  const v = value.trim();
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(v)) {
    throw new Error("Valor inválido na linha " + line + ".");
  }
  const negative = v.startsWith("-");
  const [whole, decimal = ""] = v.replace(/^[+-]/, "").split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Valor zero ou excessivo na linha " + line + ".");
  }
  return { cents, type: negative ? "expense" : "income" } as const;
}
function labelAndKey(raw: string) {
  const parts = raw.trim().split(/\s+-\s+/), title = normalize(parts[0]);
  if (title.includes("PAGAMENTO DE FATURA")) {
    return { label: "Pagamento de fatura", key: "CARD_BILL" };
  }
  if (title.includes("TRANSFERENCIA ENVIADA PELO PIX") ||
      title.includes("TRANSFERENCIA RECEBIDA PELO PIX")) {
    const sent = title.includes("ENVIADA");
    const party = safeDisplay(parts[1] || "Destinatário desconhecido");
    return { label: (sent ? "Pix para " : "Pix de ") + party,
      key: (sent ? "PIX_OUT:" : "PIX_IN:") + normalize(party) };
  }
  if (title.includes("COMPRA NO DEBITO")) {
    const party = safeDisplay(parts.slice(1).join(" - ") || "Estabelecimento");
    return { label: "Débito: " + party, key: "DEBIT:" + normalize(party) };
  }
  if (title.startsWith("ESTORNO")) {
    const party = safeDisplay(parts.slice(1).join(" - ") || "Estorno");
    return { label: "Estorno: " + party, key: "REFUND:" + normalize(party) };
  }
  const label = safeDisplay(parts.slice(0, 2).join(" - "));
  return { label, key: "OTHER:" + normalize(label) };
}
function suggestions(key: string, type: TransactionType) {
  if (key === "CARD_BILL") return { category: null, action: "transfer" as const };
  if (type === "income") return { category: null, action: null };
  if (/\b(?:POSTO|AUTOPOSTO|SHELL|IPIRANGA)\b/.test(key)) {
    return { category: "fuel" as const, action: null };
  }
  if (/\b(?:MERCADOS?|SUPERMERCADOS?|OXXO|IFOOD|PADARIA|RESTAURANTE)\b/.test(key)) {
    return { category: "food" as const, action: null };
  }
  if (/\b(?:DROGASIL|DROGARIA|FARMACIA)\b/.test(key)) {
    return { category: "health" as const, action: null };
  }
  if (/\bMOTTU\b/.test(key)) return { category: "vehicle" as const, action: null };
  return { category: null, action: null };
}
export function parseNubankAccountCsv(csv: string): NubankAccountRow[] {
  const records = parseCsvRecords(csv);
  if (!records.length) throw new Error("Arquivo CSV vazio.");
  const header = records[0].fields.map(normalize);
  if (header.includes("DATE") && header.includes("AMOUNT") && header.includes("TITLE")) {
    throw new Error("Este CSV é da fatura. Escolha o extrato da conta Nubank (Data, Valor, Identificador, Descrição).");
  }
  const expected = ["DATA", "VALOR", "IDENTIFICADOR", "DESCRICAO"];
  const indices = expected.map((h) => header.indexOf(h));
  if (header.length !== 4 || indices.includes(-1) || new Set(header).size !== 4) {
    throw new Error("Formato inválido. Exige Data, Valor, Identificador e Descrição.");
  }
  const seen = new Map<string, NubankAccountRow>(), rows: NubankAccountRow[] = [];
  for (const { fields, line } of records.slice(1)) {
    if (fields.length !== 4) throw new Error("Colunas incorretas na linha " + line + ".");
    const [date, value, id, desc] = indices.map((i) => fields[i].trim());
    if (!/^[a-z0-9][a-z0-9_-]{7,99}$/i.test(id)) {
      throw new Error("Identificador inválido na linha " + line + ".");
    }
    if (!desc) throw new Error("Descrição vazia na linha " + line + ".");
    const amount = parseAmount(value, line);
    const { label, key } = labelAndKey(desc);
    if (!label || !key) throw new Error("Descrição inválida na linha " + line + ".");
    const suggestion = suggestions(key, amount.type);
    const row: NubankAccountRow = {
      sourceId: id, dateISO: parseDateBr(date, line), amountCents: amount.cents,
      type: amount.type, description: label, merchantKey: key,
      suggestedCategory: suggestion.category, suggestedAction: suggestion.action,
    };
    const prior = seen.get(id);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(row)) {
        throw new Error("Identificador repetido com dados diferentes na linha " + line + ".");
      }
      continue;
    }
    seen.set(id, row); rows.push(row);
  }
  if (!rows.length) throw new Error("Extrato sem movimentações.");
  return rows;
}
