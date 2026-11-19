import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet,
  Switch, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseCategoryOptions, IncomeCategoryOptions, type ExpenseCategory, type IncomeCategory } from "@/src/domain/categories";
import type { ImportAction } from "@/src/domain/nubankCsv";
import {
  getNubankReviewQueue, getNubankPossibleDuplicates, saveNubankPendingCategory,
  reviewNubankImport, stageNubankImport, undoNubankImport,
  getNubankImportBatches, cancelNubankPendingBatch,
  getNubankCategoryGroup, categorizeNubankPendingGroup, getNubankLearnedCategory,
} from "@/src/db/nubankImport";
import type {
  BankImportItem, ExistingTransactionMatch, ImportBatchSummary,
  LearnedCategory, GroupScope,
} from "@/src/db/nubankImportCore";
import { selectNubankAccountCsv } from "@/src/services/nubankImportFile";

function money(value: number): string {
  return (value / 100).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL",
  });
}
function dateBr(iso: string): string {
  const [year, month, day] = iso.split("-");
  return day + "/" + month + "/" + year;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

type Queue = { items: BankImportItem[]; pending: number; offset: number; pageSize: number };
export default function NubankCsvImportScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [queue, setQueue] = useState<Queue>({
    items: [], pending: 0, offset: 0, pageSize: 50,
  });
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [suggestedAction, setSuggestedAction] = useState<ImportAction>("import");
  const [similar, setSimilar] = useState(false);
  const [remember, setRemember] = useState(false);
  const [undoIds, setUndoIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [matches, setMatches] = useState<ExistingTransactionMatch[]>([]);
  const [compareBusy, setCompareBusy] = useState(false);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [showBatches, setShowBatches] = useState(false);
  const [brandGroup, setBrandGroup] = useState<{ count: number; label: string } | null>(null);
  const [learned, setLearned] = useState<LearnedCategory | null>(null);

  const load = useCallback(async (pageOffset = 0) => {
    const [result, availableBatches] = await Promise.all([
      getNubankReviewQueue(db, pageOffset),
      getNubankImportBatches(db),
    ]);
    setQueue(result);
    setBatches(availableBatches);
    setCursor((index) => Math.min(index, Math.max(0, result.items.length - 1)));
    return result;
  }, [db]);

  useFocusEffect(useCallback(() => {
    void load().catch((error) => Alert.alert("Erro ao carregar extratos", message(error)));
  }, [load]));

  const item = queue.items[cursor] ?? null;
  useEffect(() => {
    setCategory(item?.category ?? item?.ruleCategory ?? item?.suggestedCategory ?? null);
    setSuggestedAction(item?.ruleAction ?? item?.suggestedAction ?? "import");
    setSimilar(false);
    setRemember(false);
    setCompareOpen(false);
    setMatches([]);
  }, [item?.id]);

  useEffect(() => {
    let active = true;
    setBrandGroup(null);
    setLearned(null);
    if (!item) return () => { active = false; };
    void Promise.all([
      getNubankCategoryGroup(db, item.id, "brand").catch(() => null),
      getNubankLearnedCategory(db, item.merchantKey, item.type),
    ]).then(([group, suggestion]) => {
      if (!active) return;
      setBrandGroup(group);
      setLearned(suggestion);
      if (suggestion && item.category === null && item.ruleCategory === null) {
        setCategory((current) => current ?? suggestion.category);
      }
    }).catch((error) => {
      if (active) setNotice("Sugestões indisponíveis: " + message(error));
    });
    return () => { active = false; };
  }, [db, item?.id]);


  function confirmCancelBatch(batch: ImportBatchSummary) {
    if (busy) return;
    Alert.alert(
      "Abandonar revisão deste extrato?",
      "Extrato de " + dateBr(batch.firstDate) + " a " + dateBr(batch.lastDate) +
      ".\n\nDescartar " + batch.pending + " movimentações PENDENTES? " +
      batch.reviewed + " decisões já concluídas serão preservadas. " +
      "Esta operação não apaga transações financeiras e você pode importar o CSV novamente.",
      [
        { text: "Manter pendências", style: "cancel" },
        {
          text: "Descartar " + batch.pending,
          style: "destructive",
          onPress: () => { void cancelBatch(batch.createdAt); },
        },
      ],
    );
  }

  async function cancelBatch(createdAt: number) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await cancelNubankPendingBatch(db, createdAt);
      setCursor(0);
      await load(0);
      setNotice(result.cancelled + " pendência(s) descartada(s). " +
        result.preservedReviewed + " movimentação(ões) previamente revisada(s) preservada(s).");
      setUndoIds([]);
    } catch (error) {
      Alert.alert("Não foi possível cancelar o extrato", message(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmClassifyGroup(scope: GroupScope) {
    if (!item || busy) return;
    if (!category) {
      Alert.alert("Escolha uma categoria", "Escolha a categoria antes de classificar o grupo.");
      return;
    }
    void getNubankCategoryGroup(db, item.id, scope).then((group) => {
      Alert.alert(
        "Classificar sem importar",
        "Marcar " + group.count + " movimentações pendentes como " +
        (categories.find((c) => c.key === category)?.label ?? category) +
        "?\n\nA categoria será salva, mas nenhuma despesa ou receita será criada. " +
        "Você poderá revisar as possíveis duplicatas depois.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Classificar " + group.count, onPress: () => { void classifyGroup(scope, category); } },
        ],
      );
    }).catch((error) => Alert.alert("Grupo indisponível", message(error)));
  }

  async function classifyGroup(scope: GroupScope, selectedCategory: string) {
    if (!item || busy) return;
    setBusy(true);
    try {
      const changed = await categorizeNubankPendingGroup(db, item.id, selectedCategory, scope);
      setNotice(changed + " movimentação(ões) categorizada(s). Nenhuma foi importada.");
      await load(queue.offset);
    } catch (error) {
      Alert.alert("Não foi possível classificar o grupo", message(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile() {
    if (busy) return;
    setBusy(true);
    try {
      const rows = await selectNubankAccountCsv();
      if (!rows) return;
      const result = await stageNubankImport(db, rows);
      setNotice(
        result.created + " novas para revisão, " + result.repeated +
        " já conhecidas. " + result.pending + " pendentes no total.",
      );
      setCursor(0);
      await load(0);
    } catch (error) {
      Alert.alert("Extrato não importado", message(error));
    } finally {
      setBusy(false);
    }
  }

  async function commit(action: ImportAction) {
    if (!item || busy) return;
    setBusy(true);
    try {
      const result = await reviewNubankImport(db, {
        itemId: item.id,
        action,
        category: action === "import" ? (category as ExpenseCategory | IncomeCategory | null) : null,
        applyToSimilar: similar,
        rememberRule: remember,
      });
      setUndoIds(result.rowIds);
      setNotice(
        result.reviewed + (result.reviewed === 1 ? " lançamento revisado." : " lançamentos revisados.") +
        (remember ? " Regra salva para próximas importações." : ""),
      );
      const refreshed = await load(queue.offset);
      // Após remover o registro aprovado da fila, o próximo ocupa seu lugar.
      setCursor(Math.min(cursor, Math.max(0, refreshed.items.length - 1)));
    } catch (error) {
      Alert.alert("Não foi possível revisar", message(error));
    } finally {
      setBusy(false);
    }
  }

  async function showComparison() {
    if (!item || compareBusy) return;
    if (compareOpen) {
      setCompareOpen(false);
      return;
    }
    setCompareBusy(true);
    try {
      const results = await getNubankPossibleDuplicates(db, item.id);
      setMatches(results);
      setCompareOpen(true);
    } catch (error) {
      Alert.alert("Falha na comparação", message(error));
    } finally {
      setCompareBusy(false);
    }
  }

  async function changePosition(direction: -1 | 1) {
    if (!item || busy) return;
    setBusy(true);
    try {
      // Escolher uma categoria não aprova a movimentação. Porém,
      // a escolha fica disponível quando o usuário voltar a ela.
      await saveNubankPendingCategory(db, item.id, category);
      if (direction === 1 && cursor + 1 < queue.items.length) {
        setCursor(cursor + 1);
      } else if (direction === -1 && cursor > 0) {
        setCursor(cursor - 1);
      } else if (direction === 1 && queue.offset + queue.items.length < queue.pending) {
        setCursor(0);
        await load(queue.offset + queue.pageSize);
      } else if (direction === -1 && queue.offset > 0) {
        const result = await load(Math.max(0, queue.offset - queue.pageSize));
        setCursor(Math.max(0, result.items.length - 1));
      } else if (direction === 1) {
        setNotice("Última pendência alcançada. Você pode voltar ou fechar a revisão.");
      }
    } catch (error) {
      Alert.alert("Não foi possível guardar a categoria", message(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmAction(action: ImportAction) {
    if (!item || busy) return;
    if (action === "import" && item.type === "income" && !category) {
      Alert.alert("Escolha uma categoria", "Entradas precisam ser classificadas como salário, entrega ou receita única.");
      return;
    }
    const groupCount = similar ? item.pendingGroupCount : 1;
    if (action === "import" && similar && item.similarCount > 0) {
      Alert.alert(
        "Revise as duplicatas",
        "Esta movimentação tem uma coincidência no Mototrack. Desative 'Aplicar às semelhantes' para avaliar cada ocorrência antes de importar.",
        [{ text: "Ver comparação", onPress: () => { void showComparison(); } }, { text: "OK" }],
      );
      return;
    }
    const perform = () => {
      if (action === "import" && item.similarCount > 0) {
        Alert.alert(
          "Possível duplicata",
          "Há " + item.similarCount + " lançamento(s) com a mesma data, valor e tipo. " +
          "Confira a comparação antes de criar mais um lançamento.",
          [
            { text: "Comparar registros", onPress: () => { void showComparison(); } },
            { text: "Cancelar", style: "cancel" },
            { text: "Importar mesmo assim", onPress: () => { void commit(action); } },
          ],
        );
        return;
      }
      void commit(action);
    };
    if (groupCount > 1) {
      Alert.alert(
        "Confirmar decisão em lote",
        "Essa ação afetará " + groupCount + " movimentações pendentes do mesmo estabelecimento/destinatário. " +
        (remember ? "Também salvará uma regra de sugestão para o futuro." : "As regras futuras não serão alteradas."),
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar " + groupCount, onPress: perform },
        ],
      );
      return;
    }
    perform();
  }

  async function undo() {
    if (!undoIds.length || busy) return;
    setBusy(true);
    try {
      await undoNubankImport(db, undoIds);
      setNotice("Última revisão desfeita. Regras salvas permanecem ativas.");
      setUndoIds([]);
      setCursor(0);
      await load(0);
    } catch (error) {
      Alert.alert("Não foi possível desfazer", message(error));
    } finally {
      setBusy(false);
    }
  }

  const categories = item?.type === "income"
    ? IncomeCategoryOptions : ExpenseCategoryOptions;
  const actionHint = item?.ruleAction
    ? "Regra sua já salva — revise antes de confirmar."
    : item?.suggestedAction || item?.suggestedCategory
      ? "Sugestão automática — você decide se aceita."
      : "Sem sugestão: aguarda sua decisão.";

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.heading}>Extrato Nubank</Text>
        <Pressable onPress={() => router.back()} style={styles.close} disabled={busy}>
          <Text style={styles.muted}>Fechar</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.description}>
          Importe o CSV da conta. As movimentações ficam separadas dos lançamentos
          do Mototrack até você aprová-las. Nenhum arquivo é enviado a um servidor.
        </Text>
        <Pressable style={[styles.primary, busy && styles.disabled]} onPress={() => void chooseFile()} disabled={busy}>
          <Text style={styles.primaryText}>
            {busy ? "Processando…" : "Selecionar extrato CSV"}
          </Text>
        </Pressable>
        {busy ? <ActivityIndicator color="#FFB35A" style={styles.spinner} /> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {batches.length > 0 ? (
          <View style={styles.batchPanel}>
            <Pressable
              style={styles.row}
              onPress={() => setShowBatches((value) => !value)}
            >
              <Text style={styles.sectionTitle}>Extratos em revisão ({batches.length})</Text>
              <Text style={styles.compareText}>{showBatches ? "Ocultar" : "Gerenciar"}</Text>
            </Pressable>
            {showBatches ? batches.map((batch) => (
              <View key={batch.createdAt} style={styles.batchItem}>
                <Text style={styles.compareTitle}>
                  {dateBr(batch.firstDate)} — {dateBr(batch.lastDate)}
                </Text>
                <Text style={styles.muted}>
                  Importado em {new Date(batch.createdAt).toLocaleString("pt-BR")}
                </Text>
                <Text style={styles.muted}>
                  {batch.pending} pendente(s) · {batch.reviewed} já revisada(s)
                </Text>
                <Pressable
                  style={styles.cancelBatchButton}
                  disabled={busy}
                  onPress={() => confirmCancelBatch(batch)}
                >
                  <Text style={styles.warning}>Descartar pendências deste extrato</Text>
                </Pressable>
              </View>
            )) : null}
          </View>
        ) : null}

        <View style={styles.summary}>
          <Text style={styles.summaryCount}>{queue.pending}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryTitle}>Aguardando revisão</Text>
            <Text style={styles.muted}>Decisões adiadas continuam salvas no aparelho.</Text>
          </View>
        </View>
        {undoIds.length ? (
          <Pressable onPress={() => void undo()} disabled={busy} style={styles.undo}>
            <Text style={styles.undoText}>Desfazer última decisão ({undoIds.length})</Text>
          </Pressable>
        ) : null}

        {!item ? (
          <View style={styles.empty}>
            <Text style={styles.summaryTitle}>Nenhuma movimentação pendente</Text>
            <Text style={styles.muted}>
              Selecione um extrato. Importar o mesmo arquivo novamente não duplica seus registros.
            </Text>
          </View>
        ) : (
          <View style={styles.review}>
            <View style={styles.row}>
              <Text style={styles.sectionTitle}>Revisar movimentação</Text>
              <Text style={styles.muted}>{queue.offset + cursor + 1} de {queue.pending} pendentes</Text>
            </View>
            <View style={styles.item}>
              <Text style={styles.muted}>{dateBr(item.dateISO)} · {item.type === "income" ? "Entrada" : "Saída"}</Text>
              <Text style={[styles.amount, item.type === "income" && styles.income]}>
                {item.type === "income" ? "+ " : "− "}{money(item.amountCents)}
              </Text>
              <Text style={styles.title}>{item.description}</Text>
              <Text style={styles.hint}>{actionHint}</Text>
              {learned ? (
                <View style={styles.learnPanel}>
                  <Text style={styles.compareSource}>APRENDIDO COM SEUS LANÇAMENTOS</Text>
                  <Text style={styles.muted}>
                    {learned.exampleTitle} → {categories.find(c => c.key === learned.category)?.label ?? learned.category}
                    {" · "}{learned.count} ocorrência(s) anterior(es)
                  </Text>
                  <Pressable
                    onPress={() => setCategory(learned.category)}
                    style={styles.compareButton}
                    disabled={busy}
                  >
                    <Text style={styles.compareText}>Usar categoria aprendida</Text>
                  </Pressable>
                </View>
              ) : null}
              {item.ruleAction || item.suggestedAction ? (
                <Text style={styles.hint}>
                  Ação sugerida: {suggestedAction === "transfer" ? "Transferência"
                    : suggestedAction === "ignore" ? "Ignorar" : "Importar"}.
                  A aprovação continua sendo manual.
                </Text>
              ) : null}
              {item.similarCount > 0 ? (
                <>
                  <Text style={styles.warning}>
                    {item.similarCount} possível(is) duplicata(s) no Mototrack — mesma data, tipo e valor.
                  </Text>
                  <Pressable style={styles.compareButton} onPress={() => void showComparison()} disabled={compareBusy}>
                    <Text style={styles.compareText}>
                      {compareBusy ? "Procurando…" : compareOpen ? "Ocultar comparação" : "Comparar com o Mototrack"}
                    </Text>
                  </Pressable>
                  {compareOpen ? (
                    <View style={styles.compareSection}>
                      <View style={styles.compareCard}>
                        <Text style={styles.compareSource}>EXTRATO NUBANK · A IMPORTAR</Text>
                        <Text style={styles.compareTitle}>{item.description}</Text>
                        <Text style={styles.muted}>{dateBr(item.dateISO)} · {money(item.amountCents)}</Text>
                        <Text style={styles.muted}>Categoria atual: {category ?? "Sem categoria"}</Text>
                      </View>
                      {matches.map((existing) => (
                        <View key={existing.id} style={styles.compareCard}>
                          <Text style={styles.compareSource}>
                            MOTOTRACK · REGISTRO EXISTENTE #{existing.id}
                          </Text>
                          <Text style={styles.compareTitle}>{existing.title}</Text>
                          <Text style={styles.muted}>
                            {dateBr(existing.dateISO)} · {money(existing.amountCents)}
                          </Text>
                          <Text style={styles.muted}>
                            Categoria: {existing.category ?? "Sem categoria"}
                            {existing.distanceMeters === null ? "" :
                              " · " + (existing.distanceMeters / 1000).toFixed(1) + " km"}
                          </Text>
                        </View>
                      ))}
                      <Text style={styles.muted}>
                        Coincidência não é certeza de duplicação. Você pode ignorar o novo, importar mesmo assim ou adiar.
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}
              {item.merchantKey === "CARD_BILL" ? (
                <Text style={styles.warning}>
                  Pagamento da fatura: não conte duas vezes se também importar as compras do cartão.
                  Marcar como transferência só faz sentido quando os gastos estão registrados separadamente.
                </Text>
              ) : null}
            </View>

            <Text style={styles.sectionTitle}>
              {item.type === "income" ? "Categoria da entrada" : "Categoria da movimentação (opcional)"}
            </Text>
            <View style={styles.chips}>
              {item.type === "expense" ? (
                <Pressable onPress={() => setCategory(null)} style={[styles.chip, category === null && styles.active]}>
                  <Text style={styles.chipText}>Sem categoria</Text>
                </Pressable>
              ) : null}
              {categories.map((entry) => (
                <Pressable
                  key={entry.key}
                  onPress={() => setCategory(entry.key)}
                  style={[styles.chip, category === entry.key && styles.active]}
                >
                  <Text style={styles.chipText}>{entry.label}</Text>
                </Pressable>
              ))}
            </View>

            {((item.pendingGroupCount > 1) || (brandGroup && brandGroup.count > 1)) ? (
              <View style={styles.learnPanel}>
                <Text style={styles.sectionTitle}>Classificar em lote, sem importar</Text>
                <Text style={styles.muted}>
                  Você pode salvar a categoria de várias compras de uma vez. Elas continuam
                  pendentes para confirmar ou conciliar depois.
                </Text>
                {item.pendingGroupCount > 1 ? (
                  <Pressable
                    style={styles.compareButton}
                    disabled={busy}
                    onPress={() => confirmClassifyGroup("exact")}
                  >
                    <Text style={styles.compareText}>
                      Classificar {item.pendingGroupCount} descrições idênticas
                    </Text>
                  </Pressable>
                ) : null}
                {brandGroup && brandGroup.count > item.pendingGroupCount ? (
                  <Pressable
                    style={styles.compareButton}
                    disabled={busy}
                    onPress={() => confirmClassifyGroup("brand")}
                  >
                    <Text style={styles.compareText}>
                      Classificar {brandGroup.count} variações de {brandGroup.label}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Text style={styles.switchTitle}>Aplicar esta decisão às descrições idênticas</Text>
                <Text style={styles.muted}>
                  {item.pendingGroupCount} pendente(s) do mesmo estabelecimento/destinatário e direção.
                </Text>
              </View>
              <Switch value={similar} onValueChange={setSimilar} disabled={busy} trackColor={{ true: "#DFA353" }} />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Text style={styles.switchTitle}>Lembrar minha decisão</Text>
                <Text style={styles.muted}>Sugere a mesma ação em futuros CSVs; nunca aprova sem você.</Text>
              </View>
              <Switch value={remember} onValueChange={setRemember} disabled={busy} trackColor={{ true: "#DFA353" }} />
            </View>

            <Pressable
              style={[styles.primary, busy && styles.disabled]}
              disabled={busy}
              onPress={() => confirmAction("import")}
            >
              <Text style={styles.primaryText}>Confirmar importação no Mototrack</Text>
            </Pressable>
            <View style={styles.twoButtons}>
              <Pressable style={styles.secondary} disabled={busy} onPress={() => confirmAction("transfer")}>
                <Text style={styles.secondaryText}>Marcar transferência</Text>
              </Pressable>
              <Pressable style={styles.secondary} disabled={busy} onPress={() => confirmAction("ignore")}>
                <Text style={styles.secondaryText}>Ignorar</Text>
              </Pressable>
            </View>
            <View style={styles.twoButtons}>
              <Pressable
                style={styles.outline}
                disabled={busy}
                onPress={() => { void changePosition(-1); }}
              >
                <Text style={styles.outlineText}>Anterior</Text>
              </Pressable>
              <Pressable
                style={styles.outline}
                disabled={busy}
                onPress={() => { void changePosition(1); }}
              >
                <Text style={styles.outlineText}>Salvar e próxima</Text>
              </Pressable>
            </View>
          </View>
        )}
        <Text style={styles.muted}>
          As escolhas de categoria são salvas ao navegar, mas não importadas sem confirmação.
          {queue.pending > 0 ? " A lista tem " + queue.pending + " pendências ao todo." : ""}
        </Text>
        <Text style={styles.disclaimer}>
          Recomendações não são certezas. Pix entre contas próprias, estornos, pagamentos
          de fatura e reembolsos exigem cuidado para não distorcer receitas ou gastos.
          O suporte a CSV de fatura será desenvolvido separadamente.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#101025" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { color: "#FFF", fontSize: 21, fontWeight: "800" },
  close: { padding: 8 },
  content: { paddingHorizontal: 20, paddingBottom: 52, gap: 13 },
  description: { color: "#BCBBCD", fontSize: 13, lineHeight: 20 },
  primary: { backgroundColor: "#FFB35A", borderRadius: 12, padding: 14, alignItems: "center" },
  primaryText: { color: "#171224", fontWeight: "800", fontSize: 14 },
  spinner: { marginVertical: 6 },
  disabled: { opacity: 0.5 },
  notice: { color: "#C8E2CC", fontSize: 13, lineHeight: 19 },
  summary: { flexDirection: "row", gap: 12, padding: 14,
    borderRadius: 12, backgroundColor: "#24243A", alignItems: "center" },
  summaryCount: { color: "#FFB35A", fontSize: 32, fontWeight: "800" },
  summaryTitle: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  muted: { color: "#A9A8BA", fontSize: 12, lineHeight: 18 },
  undo: { padding: 10, alignItems: "center", borderWidth: 1,
    borderColor: "#FFB35A", borderRadius: 10 },
  undoText: { color: "#FFB35A", fontWeight: "600", fontSize: 13 },
  empty: { padding: 20, backgroundColor: "#212135", borderRadius: 12, gap: 8 },
  review: { gap: 13, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  item: { padding: 16, backgroundColor: "#24243A", borderRadius: 14, gap: 9 },
  amount: { color: "#FFB6AD", fontSize: 25, fontWeight: "800" },
  income: { color: "#8EDBBB" },
  title: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  hint: { color: "#BDB5E6", fontSize: 12 },
  warning: { color: "#FFCF91", fontSize: 12, lineHeight: 19 },
  compareButton: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "#38334C", borderRadius: 10, alignSelf: "flex-start" },
  compareText: { color: "#FFCF91", fontSize: 13, fontWeight: "700" },
  compareSection: { gap: 8, marginTop: 4 },
  batchPanel: { gap: 10, borderWidth: 1, borderColor: "#48425D",
    backgroundColor: "#211F37", borderRadius: 12, padding: 12 },
  batchItem: { borderTopWidth: 1, borderColor: "#49435B", gap: 5, paddingVertical: 10 },
  cancelBatchButton: { borderWidth: 1, borderColor: "#9C6170",
    borderRadius: 10, padding: 9, alignSelf: "flex-start" },
  learnPanel: { gap: 10, padding: 12, backgroundColor: "#26233C", borderRadius: 12 },
  compareCard: { borderWidth: 1, borderColor: "#514A65", backgroundColor: "#1E1D30", borderRadius: 10, padding: 12, gap: 5 },
  compareSource: { color: "#FFCF91", fontSize: 11, fontWeight: "800" },
  compareTitle: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20,
    borderColor: "#48465F", borderWidth: 1 },
  active: { borderColor: "#FFB35A", backgroundColor: "#503E42" },
  chipText: { color: "#FFF", fontSize: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  switchLabel: { flex: 1, gap: 3 },
  switchTitle: { color: "#FFF", fontSize: 13, fontWeight: "600" },
  twoButtons: { flexDirection: "row", gap: 10 },
  secondary: { flex: 1, padding: 12, borderRadius: 11, alignItems: "center",
    backgroundColor: "#353047" },
  secondaryText: { color: "#FFF", fontSize: 13, fontWeight: "700" },
  outline: { flex: 1, padding: 10, borderRadius: 10, alignItems: "center",
    borderWidth: 1, borderColor: "#5D5670" },
  outlineText: { color: "#DBD2E4", fontSize: 13 },
  disclaimer: { color: "#8E90A2", fontSize: 11, lineHeight: 18, marginTop: 10 },
});
