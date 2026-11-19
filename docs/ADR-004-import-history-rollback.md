# ADR-004 — Histórico de extratos e reversão segura por lote

**Branch:** `feat/nubank-import-history-rollback`, baseada na `feat/nubank-review-batches-and-learning`. Não afeta a versão do celular até gerar outra build.

## Contexto
O usuário pode importar o mesmo período sobre um backup contendo lançamentos manuais, classificar parte do CSV, aprovar um grupo e depois perceber que repetiu despesas. Restaurar o backup inteiro resolveria algumas duplicações, mas também apagaria decisões legítimas posteriores. A reversão precisa ser seletiva, auditável e conservadora.

## Identificadores e privacidade
- `transactions.id`: identificador interno de lançamentos manuais ou importados; o usuário **não** precisa digitá-lo.
- `bank_import_rows.sourceId`: identificador gerado pelo Nubank para cada movimentação; é necessário para evitar dupla importação do mesmo extrato ou extratos sobrepostos. Não é CPF, conta, agência ou senha.
- `bank_import_rows.transactionId`: vínculo interno entre movimentação e lançamento criado.
- `transactions.notes`: a versão anterior gravava `mototrack:nubank-account:<sourceId>` para recuperação de backups v1. **Este PR preserva o comportamento por compatibilidade**, mas a arquitetura futura deve transferir essa informação para uma tabela interna específica, sem expô-la nas observações pessoais. Lançamentos manuais não exigem `sourceId`.
- Todos os dados ficam no SQLite local e são incluídos no JSON de backup. O arquivo de backup deve ser tratado como informação financeira pessoal e guardado fora de repositórios públicos.

## Migração v3
Duas estruturas novas, sem apagar dados anteriores:
- `bank_import_batches` guarda cada sessão de importação, datas mínima/máxima, contagem original, pendências descartadas e última ação.
- `bank_import_batch_events` registra ações posteriores: `pending_cancelled` e `approved_reversed`, quantidade e horário.
- Lotes existentes da v2 são reconstruídos a partir de `bank_import_rows.createdAt`. Descartes anteriores à v3 não são recuperáveis retroativamente caso suas linhas já tenham sido excluídas.
- Nova importação escolhe um timestamp de lote exclusivo em relação aos já registrados para evitar colisão de milissegundos.

### Histórico de importação
O gerenciamento passa a apresentar **todos** os lotes, inclusive os concluídos e os que tiveram todas as pendências canceladas. Mostra pendentes, aprovados ativos, ignorados, transferências, inativos e cancelados, além de ações anteriores.

A classificação `inativo` deriva de `transactions.deletedAt` e pode incluir exclusões manuais anteriores; só o evento `approved_reversed` comprova ação específica do importador.

### Duas ações diferentes
- **Descartar pendências:** remove apenas as linhas `pending` do lote, sem afetar lançamentos financeiros existentes. Registra quantidade cancelada e evento de auditoria.
- **Verificar reversão:** calcula prévia dos lançamentos `imported` ainda ativos e elegíveis. Só executa após confirmação explícita, criando uma cópia local verificada do backup antes da alteração.

## Proteções para reverter
Para cada possível reversão, validar:
1. `bank_import_rows.status = imported`, origem e lote reconhecidos;
2. `transactionId` aponta para **uma** transação e não é compartilhado com outra importação;
3. `notes` possui exatamente a marca interna e o `sourceId` original;
4. mesmo tipo, data, valor exato em centavos, título e categoria produzidos pelo importador;
5. nenhuma distância atribuída e `createdAt === updatedAt` no lançamento, indicando ausência de edição por meio das funções atuais;
6. `deletedAt IS NULL`.

Se uma transação tiver sido alterada, não se encaixar nas provas de origem ou já estiver inativa, **não será revertida automaticamente**.

A prévia informa quantidade de itens elegíveis, bloqueados, inativos, receitas e despesas que serão retiradas. No momento da execução, a análise é repetida dentro de uma **transação SQL exclusiva (Android/iOS)**. Se os itens ou somas mudarem, a operação inteira aborta. Cada exclusão é **lógica** (`deletedAt`), não apaga dados para sempre, e gera evento de reversão. O status de importação original permanece vinculado ao ID externo para impedir nova duplicação silenciosa ao reimportar o CSV.

**Limitação:** não reverte automaticamente regras de categoria criadas durante uma aprovação (podem ter servido a outros arquivos), nem transações editadas. Não reverte lançamentos manuais de valores iguais. Não há sincronização com o banco; isso apenas altera lançamentos do Mototrack.

## Backup v3
Exporta `transactions`, `bankImportRows`, `bankImportRules`, `bankImportBatches` e `bankImportEvents`.
- A validação verifica IDs duplicados, datas, categorias e vínculo de eventos com lotes; falhas impedem restauração.
- A restauração substitui tudo **na mesma transação**, recuperando eventos e lotes.
- Backups v1 e v2 continuam legíveis. O v1 não contém fila/regras/histórico; v2 contém fila/regras e reconstrói os lotes com as informações ainda presentes, mas não tem eventos de cancelamento/reversão.
- Para reverter, uma cópia local v3 é salva e relida antes da transação; **a cópia deve ser exportada para fora do aplicativo** para resistir à desinstalação.

## QA obrigatório
1. Em instalação isolada, começar com banco v2 contendo pendências, aprovados e regras; atualizar para v3 sem perder registros.
2. Confirmar que histórico mostra um lote completo, mesmo sem pendências; e mostra um lote totalmente cancelado.
3. Importar duas compras fictícias e uma compra manual com mesma data/valor: prévia e reversão **nunca** atingem a manual.
4. Editar um lançamento importado antes de solicitar a reversão: deve ser bloqueado, enquanto os não editados podem ser revertidos.
5. Forçar falha SQL no segundo lançamento ou na gravação do evento: rollback integral.
6. Exportar backup v3, restaurar e verificar totais, notas, vínculo bancário e eventos.
7. Restaurar backups v1 e v2 em banco **de teste** e observar avisos de perda de estruturas que não existiam na versão anterior.
8. Reimportar o mesmo CSV após uma reversão: não criar uma segunda despesa.
9. Verificar no Android real a confirmação de reversão, prévia, responsividade e persistência após fechar/reabrir o app.

## Decisões adiadas
- Um cadastro explícito de aliases/estabelecimentos e motor de conciliação são melhores para comparar compras manuais do backup antigo; estes NÃO são apagados por uma operação de reversão.
- O `sourceId` permanecerá internamente enquanto necessário para idempotência. A conveniência para o usuário exige não exibi-lo como campo editável comum nem pedir para preencher isso manualmente.
- Um diário completo por movimentação poderá registrar mudanças de categoria e conciliações futuras, mas não é necessário para a primeira reversão segura por lote.

**Não mesclar este PR à base do usuário sem QA real em Android.** O PR #14, que ele pretende testar, permanece separado.
