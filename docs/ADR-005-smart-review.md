# ADR-005 — Revisão inteligente e conciliação de extratos

**Estado:** experimental; branch `feat/nubank-smart-review`, baseada no PR #15. Não mesclar em `develop` ou `master` antes de QA Android.

## Objetivo
Substituir uma revisão sequencial de centenas de movimentações por **análise inicial → resolução de exceções → confirmação em lote**, com opção de inspecionar todas as movimentações e desfazer mesclagens. Motivação: extratos anteriores se sobrepõem a lançamentos manuais restaurados de backup, com descrições como `Oxxo` / `Oxxo Piscinas`.

## Resumo do novo fluxo
Após selecionar CSV, o app informa quatro grupos de **pendentes**:
1. **Prontas**: categoria de rascunho, regra do usuário, sugestão do parser ou histórico consistente, sem coincidência ativa de data/tipo/valor em registros existentes e sem outras movimentações pendentes com mesmo dia/tipo/valor.
2. **Possíveis duplicatas**: coincidências de dia/tipo/valor no Mototrack; ou duas movimentações novas no próprio CSV com essa combinação. Não se presume que são a mesma compra.
3. **Sem categoria**: nenhuma proposta consistente disponível.
4. **Não contabilizar?**: operações que sugerem transferência interna, pagamento de fatura ou outra ação sem impacto no dashboard. Pix para terceiros **não** é automaticamente transferência própria.

As métricas não são lançamentos definitivos. **Importar X prontas** calcula uma prévia com IDs, categorias, entradas e saídas. Após confirmação, uma cópia v4 do banco é salva e verificada. Em seguida o núcleo SQL recalcula a análise dentro da transação e compara a prévia; se alguma candidata mudou, aborta. Cada registro passa por nova verificação de duplicata antes do INSERT. Uma falha cancela **o lote inteiro**.

## Resolver duplicatas
Exibir registro do CSV e possíveis lançamentos do Mototrack. Opções:
- **Mesclar com este**: vincula `bank_import_rows.sourceId` e `transactionId` ao lançamento existente; `status='merged'`, `resolutionReason='linked_existing'`. **Não altera nenhuma coluna** da transação manual, não cria outra despesa, não altera salário ou quilômetros. A descrição bancária e identificador ficam preservados na linha de origem. Exige exatamente mesma data, direção e centavos, transação ativa e sem vínculo bancário anterior. Se houver vários candidatos, decisão sempre manual.
- **Adicionar como novo**: registra outra transação separada, exigindo confirmação explícita inclusive quando a mesma data/valor existe no histórico.
- **Não importar**: marca como ignorada `resolutionReason='duplicate_rejected'` sem criar ou modificar lançamentos.
- **Desfazer mesclagem**: no histórico, remove somente vínculo e devolve a movimentação a `pending`. A transação manual permanece intacta.

A reversão do PR #15 continua a afetar somente transações que o **importador criou** (`status='imported'`), nunca `merged`.

## Categorizar em massa sem ativar importação
A categoria se propaga a um grupo exato ou a variações de marca com regra conservadora. O usuário escolhe, no diálogo:
- **Só neste extrato:** categoriza pendentes sem categoria sem salvar regra futura.
- **Lembrar nas próximas:** faz o anterior e salva sugestões locais por `merchantKey` do grupo.

A categoria é exibida nas movimentações, mas só a confirmação de importação cria lançamentos. Foram removidos os interruptores permanentes `Aplicar às semelhantes` e `Lembrar decisão`. O aplicativo ainda permite revisão individual e filtro para Todas, Prontas e Exceções.

## Não contabilizar com motivo
O menu de exceção substitui o botão genérico `Transferência` por:
- Entre minhas próprias contas;
- Fatura já contabilizada;
- Outro movimento sem impacto financeiro.

Grava `status='transfer'` e `resolutionReason` com valor interno correspondente. `Não importar` registra `status='ignored'` e razão explícita. Nenhuma dessas ações cria receita ou despesa. O motivo pode ser enriquecido posteriormente por vínculo com contas/cartões, sem inventar transferências reais.

## Migração v4
A tabela `bank_import_rows` da v3 usa `CHECK` sem `merged`. Por isso, a migração a recria transacionalmente, preservando todos os IDs, descrições, categorias, vínculos e estados anteriores. Nova coluna `resolutionReason` e índices de lote/vínculo. Versões 0/1/2/3 migram até v4, desde que o banco seja compatível.

## Backup JSON v4
Exporta linhas com `status='merged'` e `resolutionReason` e todas as estruturas v3. Backups v1, v2 e v3 continuam importáveis; ao restaurar v2 os lotes ainda disponíveis são reconstruídos, mas o histórico de eventos ausente não pode ser inferido. Restaurar um backup antigo **substitui** o estado atual; não combina backups.

## Limites conhecidos
- A sugestão de duplicata continua conservadora: data, valor e direção; não há inferência por valores diferentes, data de compensação deslocada ou correspondência semântica dos nomes. Portanto `Prontas` significa **sem conflito detectado**, não prova de que nunca foram lançadas.
- Mesclar não substitui automaticamente o nome manual por descrição mais detalhada. Os detalhes bancários adicionais ficam no vínculo de origem e podem ser usados pela visualização futura.
- O arquivo CSV é local; nenhuma informação real foi enviada ao repositório, e todos os testes usam dados fictícios.
- Uma movimentação que já foi marcada como ignorada não recebe ação de desfazer individual nesta versão; o histórico por lote continua registrando seu estado.
- O perfil EAS `preview-test` continua usando ID Android separado do app principal, mas **atualiza a instalação de teste existente**. Exportar backup externo antes de instalar.

## QA indispensável no Android
1. Exportar backup v3 da build anterior para Drive; instalar APK desta branch como Mototrack (Teste) e testar migração v3→v4.
2. Importar CSV fictício com três compras: uma igual a registro manual, uma Oxxo não repetida e uma categoria desconhecida. Conferir resumo e saldos antes da aprovação.
3. Mesclar a duplicata com o registro manual, conferir que não surge nova despesa e que o título manual não muda.
4. Desfazer a mesclagem no histórico e verificar que a movimentação volta à fila, sem alterar a original.
5. Categorizar marca e escolher `Só neste extrato`, depois `Lembrar nas próximas`; conferir sugestões futuras e ausência de lançamentos criados nessa etapa.
6. Confirmar em lote apenas os itens prontos; verificar os totais, e que dúvidas e duplicatas permanecem pendentes.
7. Usar `Adicionar como novo` para uma duplicata **fictícia**, confirmar que há dois registros e testar reversão do lote (sem remover o manual).
8. Escolher `Entre minhas próprias contas` e verificar que não altera os totais.
9. Exportar/restaurar backup v4 no aplicativo de teste e verificar vínculos, motivos e histórico.
10. Testar com um CSV de dezenas/centenas de linhas para conferir scroll, responsividade e contadores.

**Validação automatizada não substitui o teste Android.** Não instalar como app principal nesta fase.
