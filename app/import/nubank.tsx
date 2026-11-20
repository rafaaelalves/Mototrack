import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet,
  Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ExpenseCategoryOptions, IncomeCategoryOptions,
  type ExpenseCategory, type IncomeCategory,
} from "@/src/domain/categories";
import type { ExistingTransactionMatch, ImportBatchSummary,
  GroupScope, SmartBatchAnalysis, SmartReviewRow, SkipReason,
  MergedBankRow, ExcludedBankRow } from "@/src/db/nubankImportCore";
import type { BatchReversalPreview } from "@/src/db/bankBatchRollback";
import {
  analyzeNubankBatch, previewNubankReady, approveNubankReady,
  getNubankImportBatches, getNubankPossibleDuplicates, getNubankCategoryGroup,
  saveNubankPendingCategory, categorizeNubankPendingGroup, rememberNubankCategoryGroup,
  mergeNubankWithExisting, excludeNubankRow, reviewNubankImport,
  getNubankMergedRows, unmergeNubankRow,
  getNubankExcludedRows, reopenNubankExcludedRow,
  stageNubankImport, cancelNubankPendingBatch,
  previewNubankBatchReversal, reverseNubankBatch, getNubankBatchEvents,
} from "@/src/db/nubankImport";
import type { ImportBatchEvent } from "@/src/db/nubankImportCore";
import {
  saveImportRecoveryBackup, saveCancellationRecoveryBackup,
  saveReversalRecoveryBackup,
} from "@/src/services/backupFile";
import { selectNubankAccountCsv } from "@/src/services/nubankImportFile";

const money = (v:number) => (v/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dateBr = (iso:string) => {const [y,m,d]=iso.split("-");return d+"/"+m+"/"+y;};
const errorText = (e:unknown) => e instanceof Error ? e.message : "Operação não concluída.";
type Filter = "exceptions"|"ready"|"all";
type CategoryChoice = ExpenseCategory|IncomeCategory|null;

export default function NubankImport() {
  const db=useSQLiteContext();
  const router=useRouter();
  const [batches,setBatches]=useState<ImportBatchSummary[]>([]);
  const [batchId,setBatchId]=useState<number|null>(null);
  const [analysis,setAnalysis]=useState<SmartBatchAnalysis|null>(null);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [showExcludeReasons,setShowExcludeReasons]=useState(false);
  const [filter,setFilter]=useState<Filter>("exceptions");
  const [visibleLimit,setVisibleLimit]=useState(20);
  const [category,setCategory]=useState<string|null>(null);
  const [matches,setMatches]=useState<ExistingTransactionMatch[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [showHistory,setShowHistory]=useState(false);
  const [eventBatch,setEventBatch]=useState<number|null>(null);
  const [events,setEvents]=useState<ImportBatchEvent[]>([]);
  const [expandedMerged,setExpandedMerged]=useState<number|null>(null);
  const [mergedRows,setMergedRows]=useState<MergedBankRow[]>([]);
  const [expandedExcluded,setExpandedExcluded]=useState<number|null>(null);
  const [excludedRows,setExcludedRows]=useState<ExcludedBankRow[]>([]);

  const reload=useCallback(async (preferred?:number|null)=>{
    const all=await getNubankImportBatches(db);
    setBatches(all);
    const picked=all.find(x=>x.createdAt===(preferred??batchId)) ??
      all.find(x=>x.pending>0) ?? all[0] ?? null;
    setBatchId(picked?.createdAt??null);
    if(picked){
      const next=await analyzeNubankBatch(db,picked.createdAt);
      setAnalysis(next);
      setSelectedId(old => next.items.some(x=>x.id===old)?old:null);
    }else{
      setAnalysis(null);setSelectedId(null);
    }
  },[db,batchId]);

  useFocusEffect(useCallback(()=>{
    void reload().catch(e=>Alert.alert("Falha ao abrir os extratos",errorText(e)));
  },[reload]));

  const current=analysis?.items.find(x=>x.id===selectedId)??null;
  useEffect(()=>{
    setCategory(current?.category??null);
    setMatches([]);
    setShowExcludeReasons(false);
  },[current?.id,current?.category]);

  async function work(task:()=>Promise<string>,refreshBatch?:number|null){
    if(busy)return;
    setBusy(true);
    try{const response=await task();await reload(refreshBatch);setNotice(response);}
    catch(e){Alert.alert("Não foi possível concluir",errorText(e));}
    finally{setBusy(false);}
  }
  async function chooseFile(){
    if(busy)return;
    setBusy(true);
    try{
      const rows=await selectNubankAccountCsv();
      if(!rows)return;
      const result=await stageNubankImport(db,rows);
      const all=await getNubankImportBatches(db);
      setBatches(all);
      const selected=all.find(b=>b.pending>0)??all[0];
      if(selected){
        setBatchId(selected.createdAt);
        setAnalysis(await analyzeNubankBatch(db,selected.createdAt));
      }
      setSelectedId(null);setFilter("exceptions");
      setNotice(result.created+" movimentações novas; "+result.repeated+
        " já conhecidas. Revise o resumo antes de confirmar.");
    }catch(e){Alert.alert("Extrato não importado",errorText(e));}
    finally{setBusy(false);}
  }
  function approveReady(){
    if(!analysis||!analysis.ready||busy)return;
    const preview=previewNubankReady(analysis);
    Alert.alert(
      "Confirmar lançamentos prontos?",
      preview.entries.length+" lançamentos sem duplicata detectada serão adicionados.\n\n"+
      "Entradas: "+money(preview.incomeCents)+"\nSaídas: "+money(preview.expenseCents)+
      "\n\nPossíveis duplicatas e pendências NÃO serão importadas. "+
      "Uma cópia de recuperação será criada antes.",
      [{text:"Revisar mais",style:"cancel"},{
        text:"Importar "+preview.entries.length,
        onPress:()=>{void work(async()=>{
          const backup=await saveImportRecoveryBackup(db);
          const done=await approveNubankReady(db,preview);
          return done.created+" lançamentos importados. Cópia local: "+backup;
        },preview.batchCreatedAt);},
      }],
    );
  }
  function abandon(batch:ImportBatchSummary){
    if(!batch.pending||busy)return;
    Alert.alert("Descartar pendências deste extrato?",
      dateBr(batch.firstDate)+" a "+dateBr(batch.lastDate)+
      "\n\nDescartar "+batch.pending+" pendências? "+
      batch.imported+" aprovadas e "+batch.merged+" mescladas serão preservadas. "+
      "O histórico permanece disponível.",
      [{text:"Cancelar",style:"cancel"},
      {text:"Descartar pendências",style:"destructive",onPress:()=>{void work(async()=>{
        const recovery=await saveCancellationRecoveryBackup(db);
        const result=await cancelNubankPendingBatch(db,batch.createdAt);
        return result.cancelled+" pendências descartadas. Cópia local: "+recovery;
      },batch.createdAt);}}],
    );
  }
  function revert(batch:ImportBatchSummary){
    if(busy)return;
    void previewNubankBatchReversal(db,batch.createdAt).then(p=>{
      if(!p.eligible.length){
        Alert.alert("Nada a reverter",p.blocked.length+" bloqueadas; "+
          p.alreadyInactive+" já inativas. Lançamentos mesclados nunca são excluídos.");
        return;
      }
      Alert.alert("Reverter apenas lançamentos importados?",
        p.eligible.length+" elegíveis.\nReceitas: "+money(p.incomeCents)+
        "\nDespesas: "+money(p.expenseCents)+"\n"+p.blocked.length+
        " bloqueados serão preservados.\n\nTransações manuais e mescladas não serão excluídas.",
        [{text:"Cancelar",style:"cancel"},
        {text:"Reverter "+p.eligible.length,style:"destructive",
          onPress:()=>{void applyReversal(p);}}],
      );
    }).catch(e=>Alert.alert("Falha na prévia",errorText(e)));
  }
  async function applyReversal(preview:BatchReversalPreview){
    await work(async()=>{
      const backup=await saveReversalRecoveryBackup(db);
      const result=await reverseNubankBatch(db,preview);
      return result.reversed+" lançamentos revertidos por exclusão lógica. Cópia local: "+backup;
    },preview.batchCreatedAt);
  }
  async function viewEvents(id:number){
    if(eventBatch===id){setEventBatch(null);return;}
    try{setEvents(await getNubankBatchEvents(db,id));setEventBatch(id);}
    catch(e){Alert.alert("Histórico indisponível",errorText(e));}
  }
  async function showMerged(createdAt:number){
    if(expandedMerged===createdAt){setExpandedMerged(null);return;}
    try{setMergedRows(await getNubankMergedRows(db,createdAt));setExpandedMerged(createdAt);}
    catch(e){Alert.alert("Falha ao listar vínculos",errorText(e));}
  }
  function unmerge(row:MergedBankRow,createdAt:number){
    if(busy)return;
    Alert.alert("Desfazer mesclagem?",
      "Retirar o vínculo bancário de '"+row.originalTitle+"' ("+money(row.amountCents)+
      ")?\n\nA transação existente não será alterada. A movimentação do CSV voltará à revisão.",
      [{text:"Cancelar",style:"cancel"},
       {text:"Desfazer vínculo",onPress:()=>{void work(async()=>{
         await unmergeNubankRow(db,row.id);
         setMergedRows(await getNubankMergedRows(db,createdAt));
         return "Vínculo removido. A movimentação voltou à revisão.";
       },createdAt);}}],
    );
  }
  async function showExcluded(createdAt:number){
    if(expandedExcluded===createdAt){setExpandedExcluded(null);return;}
    try{setExcludedRows(await getNubankExcludedRows(db,createdAt));setExpandedExcluded(createdAt);}
    catch(e){Alert.alert("Falha ao listar decisões",errorText(e));}
  }
  function reopenExcluded(row:ExcludedBankRow,createdAt:number){
    if(busy)return;
    Alert.alert("Voltar para revisão?",
      "Reabrir '"+row.description+"' ("+money(row.amountCents)+")? "+
      "Nenhum lançamento será criado automaticamente.",
      [{text:"Cancelar",style:"cancel"},
       {text:"Reabrir movimentação",onPress:()=>{void work(async()=>{
         await reopenNubankExcludedRow(db,row.id);
         setExcludedRows(await getNubankExcludedRows(db,createdAt));
         return "Movimentação reaberta para revisão.";
       },createdAt);}}],
    );
  }
  function chooseItem(row:SmartReviewRow){
    if(selectedId===row.id){setSelectedId(null);return;}
    setSelectedId(row.id);
    if(row.status==="duplicate"){
      void getNubankPossibleDuplicates(db,row.id).then(setMatches)
        .catch(e=>Alert.alert("Comparação indisponível",errorText(e)));
    }
  }
  function categorizeOne(){
    if(!current||!category)return;
    void work(async()=>{
      await saveNubankPendingCategory(db,current.id,category);
      return "Categoria salva. Esta movimentação ainda não foi importada.";
    },analysis?.batchCreatedAt);
  }
  function categorizeGroup(scope:GroupScope){
    if(!current||!category)return;
    const rowId=current.id,chosen=category;
    void getNubankCategoryGroup(db,rowId,scope).then(group=>{
      if(!group.count){Alert.alert("Nada a classificar","As movimentações do grupo já foram classificadas.");return;}
      const examples=group.examples.map(x=>x.split(":").slice(1).join(":")).join(", ");
      Alert.alert("Classificar "+group.count+" movimentações?",
        "Exemplos: "+examples+"\n\nAs categorias existentes serão preservadas. "+
        "Nenhuma transação será importada ainda.",
        [{text:"Cancelar",style:"cancel"},
         {text:"Só neste extrato",onPress:()=>{void work(async()=>{
           const n=await categorizeNubankPendingGroup(db,rowId,chosen,scope);
           return n+" movimentações classificadas; nenhuma importada.";
         },analysis?.batchCreatedAt);}},
         {text:"Lembrar nas próximas",onPress:()=>{void work(async()=>{
           const n=await rememberNubankCategoryGroup(db,rowId,chosen,scope);
           return n.categorised+" classificadas; "+n.rules+" regra(s) salvas para sugestões futuras.";
         },analysis?.batchCreatedAt);}}],
      );
    }).catch(e=>Alert.alert("Grupo indisponível",errorText(e)));
  }
  function addIndividual(){
    if(!current||busy)return;
    const row=current,chosen=category;
    if(!chosen){Alert.alert("Categoria necessária","Escolha uma categoria para incluir a movimentação.");return;}
    Alert.alert(row.status==="duplicate"?"Adicionar uma segunda transação?":"Importar movimentação?",
      "O Mototrack criará uma nova "+(row.type==="income"?"receita":"despesa")+
      " de "+money(row.amountCents)+". "+
      (row.status==="duplicate"?"Há outra movimentação com mesma data, tipo e valor.":""),
      [{text:"Cancelar",style:"cancel"},{text:"Importar como novo",
      onPress:()=>{void work(async()=>{
        await reviewNubankImport(db,{itemId:row.id,action:"import",
          category:chosen as ExpenseCategory|IncomeCategory,applyToSimilar:false,rememberRule:false});
        setSelectedId(null);return "Movimentação adicionada como novo lançamento.";
      },analysis?.batchCreatedAt);}}],
    );
  }
  function mergeWith(tx:ExistingTransactionMatch){
    if(!current||busy)return;
    const rowId=current.id;
    Alert.alert("Mesclar sem duplicar?",
      "Associar a movimentação do banco a '"+tx.title+"' ("+money(tx.amountCents)+")?"+
      "\n\nO título, a categoria, o valor e as observações do Mototrack serão preservados. "+
      "O comprovante bancário ficará vinculado ao registro original.",
      [{text:"Cancelar",style:"cancel"},
       {text:"Mesclar",onPress:()=>{void work(async()=>{
         await mergeNubankWithExisting(db,rowId,tx.id);
         setSelectedId(null);return "Mesclado: nenhum novo lançamento financeiro foi criado.";
       },analysis?.batchCreatedAt);}}],
    );
  }
  function ignoreOne(){
    if(!current||busy)return;
    const row=current;
    Alert.alert("Não importar esta movimentação?",
      "Ela sairá das pendências, sem criar ou alterar despesas e receitas. "+
      "A decisão permanecerá registrada no extrato.",
      [{text:"Cancelar",style:"cancel"},
      {text:"Não importar",style:"destructive",onPress:()=>{void work(async()=>{
        await excludeNubankRow(db,row.id,row.status==="duplicate"?"duplicate_rejected":"not_relevant");
        setSelectedId(null);return "Movimentação descartada da revisão.";
      },analysis?.batchCreatedAt);}}],
    );
  }
  function excludeWithReason(reason:SkipReason,label:string){
    if(!current||busy)return;
    const id=current.id;
    Alert.alert("Não contabilizar",label+"\n\nEsta movimentação não será somada às receitas ou despesas.",
      [{text:"Voltar",style:"cancel"},
      {text:"Confirmar",onPress:()=>{void work(async()=>{
        await excludeNubankRow(db,id,reason);
        setSelectedId(null);return "Movimentação não contabilizada: "+label;
      },analysis?.batchCreatedAt);}}],
    );
  }

  const visible=(analysis?.items??[]).filter(x=>
    filter==="all"||(filter==="ready"?x.status==="ready":x.status!=="ready"));
  const picked=batches.find(b=>b.createdAt===batchId);
  const opts=current?.type==="income"?IncomeCategoryOptions:ExpenseCategoryOptions;

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View style={{flex:1,gap:3}}>
          <Text style={styles.heading}>Extratos bancários</Text>
          <Text style={styles.muted}>Analise, concilie e confirme apenas o necessário</Text>
        </View>
        <Pressable onPress={()=>router.back()} disabled={busy}><Text style={styles.link}>Fechar</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable style={[styles.primary,busy&&styles.disabled]}
          onPress={()=>{void chooseFile();}} disabled={busy}>
          <Text style={styles.primaryText}>+ Selecionar extrato Nubank (CSV)</Text>
        </Pressable>
        {busy?<ActivityIndicator color="#FFB35A"/>:null}
        {notice?<Text style={styles.notice}>{notice}</Text>:null}

        {batches.length>0?(
          <View style={styles.block}>
            <Text style={styles.section}>Extrato selecionado</Text>
            <View style={styles.wrap}>
              {batches.map(b=>(
                <Pressable key={b.createdAt}
                  style={[styles.chip,batchId===b.createdAt&&styles.active]}
                  onPress={()=>{setBatchId(b.createdAt);setSelectedId(null);setFilter("exceptions");
                    void reload(b.createdAt).catch(e=>Alert.alert("Erro",errorText(e)));}}>
                  <Text style={styles.chipText}>{dateBr(b.firstDate)} – {dateBr(b.lastDate)}</Text>
                </Pressable>
              ))}
            </View>
            {picked?<Text style={styles.muted}>{picked.pending} pendentes · {picked.imported} aprovados · {picked.merged} mesclados</Text>:null}
          </View>
        ):null}

        {analysis?(
          <View style={styles.block}>
            <Text style={styles.section}>Análise do extrato</Text>
            <View style={styles.metrics}>
              {([
                ["Prontas",analysis.ready,"#91DFBE"],
                ["Possíveis duplicatas",analysis.duplicate,"#FFCF91"],
                ["Sem categoria",analysis.category,"#D5C5FF"],
                ["Não contabilizar?",analysis.nonAccounting,"#B1B4CC"],
              ] as const).map(([label,num,color])=>(
                <View key={label} style={styles.metric}>
                  <Text style={[styles.metricNumber,{color}]}>{num}</Text>
                  <Text style={styles.metricLabel}>{label}</Text>
                </View>
              ))}
            </View>
            {analysis.ready>0?(
              <View style={styles.readyPanel}>
                <Text style={styles.compareTitle}>{analysis.ready} lançamento(s) pronto(s)</Text>
                <Text style={styles.muted}>Entradas: {money(analysis.incomeCents)} · Saídas: {money(analysis.expenseCents)}</Text>
                <Text style={styles.muted}>Categorizações sugeridas; nenhuma coincidência exata detectada. Confirme antes de criar lançamentos.</Text>
                <Pressable style={styles.primary} disabled={busy} onPress={approveReady}>
                  <Text style={styles.primaryText}>Importar {analysis.ready} lançamentos prontos</Text>
                </Pressable>
              </View>
            ):<Text style={styles.muted}>Nenhum lançamento está pronto. Resolva os grupos abaixo.</Text>}
          </View>
        ):(
          <View style={styles.block}>
            <Text style={styles.muted}>Selecione um CSV para começar. Lançamentos não entram no Mototrack sem confirmação.</Text>
          </View>
        )}

        {analysis&&analysis.count>0?(
          <View style={styles.block}>
            <Text style={styles.section}>Revisar movimentações</Text>
            <View style={styles.wrap}>
              {([["exceptions","Exceções"],["ready","Prontas"],["all","Todas"]] as const).map(([k,v])=>(
                <Pressable key={k} style={[styles.chip,filter===k&&styles.active]}
                  onPress={()=>{setFilter(k);setVisibleLimit(20);setSelectedId(null);}}>
                  <Text style={styles.chipText}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.muted}>{visible.length} movimentações neste filtro.</Text>
            {visible.slice(0,visibleLimit).map(row=>(
              <View key={row.id}>
                <Pressable onPress={()=>chooseItem(row)}
                  style={[styles.item,row.id===selectedId&&styles.selected]}>
                  <View style={{flex:1,gap:4}}>
                    <Text style={styles.compareTitle}>{row.description}</Text>
                    <Text style={styles.muted}>{dateBr(row.dateISO)} · {row.category??
                      (row.status==="duplicate"?"Conferir duplicata":"Sem categoria")}</Text>
                    <Text style={styles.hint}>{row.status==="ready"?"Pronta para importar":
                      row.status==="duplicate"?"Possível duplicata":
                      row.status==="category"?"Classificação pendente":"Não contabilizar?"}</Text>
                  </View>
                  <Text style={styles.value}>{row.type==="income"?"+":"−"}{money(row.amountCents)}</Text>
                </Pressable>
                {row.id===selectedId?(
                  <View style={styles.detail}>
                    <Text style={styles.section}>Resolver movimentação</Text>
                    {row.status==="duplicate"?(
                      <>
                        <Text style={styles.muted}>
                          {row.existingCount} lançamento(s) com a mesma data, tipo e valor. Compare e decida.
                        </Text>
                        {matches.map(tx=>(
                          <View key={tx.id} style={styles.compare}>
                            <Text style={styles.compareTitle}>No Mototrack: {tx.title}</Text>
                            <Text style={styles.muted}>{dateBr(tx.dateISO)} · {money(tx.amountCents)} · Categoria: {tx.category??"Nenhuma"}</Text>
                            <Pressable style={styles.action} disabled={busy} onPress={()=>mergeWith(tx)}>
                              <Text style={styles.actionText}>Mesclar com este · sem nova despesa</Text>
                            </Pressable>
                          </View>
                        ))}
                      </>
                    ):null}
                    {(row.status==="non_accounting"||showExcludeReasons)?(
                      <>
                        <Text style={styles.muted}>
                          Nem todo Pix é transferência entre contas próprias. Escolha o motivo, se for o caso.
                        </Text>
                        {([
                          ["own_transfer","Entre minhas próprias contas"],
                          ["already_recorded_card_payment","Fatura já contabilizada"],
                          ["other_non_accounting","Outro movimento sem impacto financeiro"],
                        ] as const).map(([reason,label])=>(
                          <Pressable key={reason} style={styles.action} disabled={busy}
                            onPress={()=>excludeWithReason(reason,label)}>
                            <Text style={styles.actionText}>{label}</Text>
                          </Pressable>
                        ))}
                      </>
                    ):(
                      <Pressable style={styles.action} disabled={busy}
                        onPress={()=>setShowExcludeReasons(true)}>
                        <Text style={styles.actionText}>Transferência própria ou fatura já registrada?</Text>
                      </Pressable>
                    )}
                    <Text style={styles.muted}>Categoria</Text>
                    <View style={styles.wrap}>
                      {opts.map(o=>(
                        <Pressable key={o.key} style={[styles.chip,category===o.key&&styles.active]}
                          onPress={()=>setCategory(o.key)}>
                          <Text style={styles.chipText}>{o.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.buttons}>
                      <Pressable style={styles.action} disabled={busy||!category}
                        onPress={categorizeOne}>
                        <Text style={styles.actionText}>Guardar categoria</Text>
                      </Pressable>
                      <Pressable style={styles.action} disabled={busy||!category}
                        onPress={()=>categorizeGroup("exact")}>
                        <Text style={styles.actionText}>Classificar semelhantes</Text>
                      </Pressable>
                    </View>
                    {row.merchantKey.startsWith("DEBIT:")?(
                      <Pressable style={styles.action} disabled={busy||!category}
                        onPress={()=>categorizeGroup("brand")}>
                        <Text style={styles.actionText}>Classificar variações do estabelecimento</Text>
                      </Pressable>
                    ):null}
                    <Pressable style={styles.primary} disabled={busy||!category} onPress={addIndividual}>
                      <Text style={styles.primaryText}>
                        {row.status==="duplicate"?"Adicionar como lançamento separado":"Importar apenas este lançamento"}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.action} disabled={busy} onPress={ignoreOne}>
                      <Text style={styles.warning}>🗑  Não importar esta movimentação</Text>
                    </Pressable>
                  </View>
                ):null}
              </View>
            ))}
            {visible.length>visibleLimit?(
              <Pressable style={styles.action} onPress={()=>setVisibleLimit(n=>n+30)}>
                <Text style={styles.actionText}>Mostrar mais {Math.min(30,visible.length-visibleLimit)} movimentações</Text>
              </Pressable>
            ):null}
          </View>
        ):null}

        {batches.length>0?(
          <View style={styles.block}>
            <Pressable style={styles.row} onPress={()=>setShowHistory(x=>!x)}>
              <Text style={styles.section}>Histórico e recuperação</Text>
              <Text style={styles.link}>{showHistory?"Ocultar":"Abrir"}</Text>
            </Pressable>
            {showHistory?batches.map(batch=>(
              <View key={batch.createdAt} style={styles.history}>
                <Text style={styles.compareTitle}>{dateBr(batch.firstDate)} – {dateBr(batch.lastDate)}</Text>
                <Text style={styles.muted}>
                  {batch.pending} pendentes · {batch.imported} ativos · {batch.merged} mesclados · {batch.reverted} inativos · {batch.cancelled} cancelados
                </Text>
                {batch.pending>0?(
                  <Pressable style={styles.action} onPress={()=>abandon(batch)} disabled={busy}>
                    <Text style={styles.warning}>Descartar pendências deste extrato</Text>
                  </Pressable>
                ):null}
                {batch.imported>0?(
                  <Pressable style={styles.action} onPress={()=>revert(batch)} disabled={busy}>
                    <Text style={styles.warning}>Verificar reversão das aprovações</Text>
                  </Pressable>
                ):null}
                {batch.merged>0?(
                  <>
                    <Pressable style={styles.action}
                      onPress={()=>{void showMerged(batch.createdAt);}} disabled={busy}>
                      <Text style={styles.actionText}>
                        {expandedMerged===batch.createdAt?"Ocultar mesclagens":"Consultar e desfazer mesclagens"}
                      </Text>
                    </Pressable>
                    {expandedMerged===batch.createdAt?(
                      mergedRows.map(row=>(
                        <View key={row.id} style={styles.compare}>
                          <Text style={styles.compareTitle}>{row.description}</Text>
                          <Text style={styles.muted}>
                            {dateBr(row.dateISO)} · {money(row.amountCents)} · Vinculada a {row.originalTitle}
                          </Text>
                          <Pressable style={styles.action} disabled={busy}
                            onPress={()=>unmerge(row,batch.createdAt)}>
                            <Text style={styles.warning}>Desfazer vínculo sem excluir lançamento</Text>
                          </Pressable>
                        </View>
                      ))
                    ):null}
                  </>
                ):null}
                {batch.ignored+batch.transfers>0?(
                  <>
                    <Pressable style={styles.action} disabled={busy}
                      onPress={()=>{void showExcluded(batch.createdAt);}}>
                      <Text style={styles.actionText}>
                        {expandedExcluded===batch.createdAt?"Ocultar decisões":"Rever itens não importados"}
                      </Text>
                    </Pressable>
                    {expandedExcluded===batch.createdAt?excludedRows.map(row=>(
                      <View key={row.id} style={styles.compare}>
                        <Text style={styles.compareTitle}>{row.description}</Text>
                        <Text style={styles.muted}>
                          {dateBr(row.dateISO)} · {money(row.amountCents)} · {row.resolutionReason??row.status}
                        </Text>
                        <Pressable style={styles.action} disabled={busy}
                          onPress={()=>reopenExcluded(row,batch.createdAt)}>
                          <Text style={styles.actionText}>Voltar à revisão</Text>
                        </Pressable>
                      </View>
                    )):null}
                  </>
                ):null}
                <Pressable style={styles.action} onPress={()=>{void viewEvents(batch.createdAt);}}>
                  <Text style={styles.actionText}>{eventBatch===batch.createdAt?"Ocultar eventos":"Consultar eventos anteriores"}</Text>
                </Pressable>
                {eventBatch===batch.createdAt?(
                  events.length?events.map(event=>(
                    <Text key={event.id} style={styles.muted}>
                      {new Date(event.occurredAt).toLocaleString("pt-BR")} ·
                      {" "}{event.action==="pending_cancelled"?"Pendências canceladas":"Aprovações revertidas"}: {event.affectedCount}
                    </Text>
                  )):<Text style={styles.muted}>Nenhum evento de cancelamento ou reversão.</Text>
                ):null}
              </View>
            )):null}
          </View>
        ):null}
        <Text style={styles.footer}>
          A análise é uma sugestão, não uma garantia de ausência de duplicatas.
          Mesclar mantém a transação original; não contabilizar não cria receita nem despesa.
          Faça backup externo antes de restaurar versões antigas.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  page:{flex:1,backgroundColor:"#101025"},
  header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",padding:20,gap:12},
  heading:{color:"#FFFFFF",fontSize:21,fontWeight:"800"},
  body:{paddingHorizontal:18,paddingBottom:60,gap:14},
  block:{backgroundColor:"#222238",padding:15,borderRadius:14,gap:12},
  section:{color:"#FFFFFF",fontSize:16,fontWeight:"800"},
  muted:{color:"#BAB7CD",fontSize:12,lineHeight:19},
  link:{color:"#FFCE91",fontSize:13,fontWeight:"700"},
  notice:{backgroundColor:"#284035",color:"#DEFCE9",borderRadius:9,padding:12,fontSize:12},
  primary:{backgroundColor:"#FFB35A",padding:14,borderRadius:11,alignItems:"center"},
  primaryText:{color:"#1B1A25",fontWeight:"800",fontSize:14},
  disabled:{opacity:0.5},
  row:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  wrap:{flexDirection:"row",flexWrap:"wrap",gap:7},
  chip:{borderWidth:1,borderColor:"#54506B",paddingHorizontal:11,paddingVertical:9,borderRadius:19},
  active:{backgroundColor:"#564451",borderColor:"#FFB35A"},
  chipText:{color:"#FFF",fontSize:12,fontWeight:"600"},
  metrics:{flexDirection:"row",flexWrap:"wrap",gap:8},
  metric:{backgroundColor:"#15152D",borderRadius:12,padding:12,width:"48%",minHeight:90},
  metricNumber:{fontSize:27,fontWeight:"800"},
  metricLabel:{color:"#D3CEDD",fontSize:12,lineHeight:18},
  readyPanel:{padding:13,backgroundColor:"#2C3442",borderRadius:12,gap:10},
  compareTitle:{color:"#FFFFFF",fontSize:14,fontWeight:"700",flexShrink:1},
  item:{backgroundColor:"#2B2A44",borderRadius:11,padding:13,flexDirection:"row",justifyContent:"space-between",gap:10,marginTop:6},
  selected:{borderWidth:1,borderColor:"#FFB35A"},
  hint:{color:"#E7C497",fontSize:11},
  value:{color:"#FFF",fontWeight:"700",fontSize:14},
  detail:{padding:13,gap:12,borderWidth:1,borderColor:"#514F72",borderRadius:12,backgroundColor:"#1B1B33"},
  compare:{padding:12,backgroundColor:"#34304C",borderRadius:10,gap:7},
  buttons:{flexDirection:"row",gap:8},
  action:{backgroundColor:"#37344D",padding:11,borderRadius:10,flex:1},
  actionText:{color:"#FFE0B2",fontSize:12,fontWeight:"700",textAlign:"center"},
  warning:{color:"#FFCF91",fontSize:12,fontWeight:"700",textAlign:"center"},
  history:{borderTopWidth:1,borderColor:"#49455C",paddingTop:12,gap:8},
  footer:{color:"#A7A4B8",fontSize:11,lineHeight:17},
});
