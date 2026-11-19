# QA — Revisão Nubank: duplicatas, categorias e paginação

Base: `feat/nubank-csv-import`. Esta branch melhora o fluxo de revisão sem substituir dados já importados.

## Problemas encontrados no teste Android
1. A versão inicial mostra `1 de 100` porque a consulta SQL usa `LIMIT 100`, embora mais itens estejam preservados no SQLite.
2. Marcar uma categoria e tocar em `Adiar / próxima` descarta a seleção feita no formulário — o item continua pendente, mas sem o rascunho.
3. `Possível duplicata manual` mostra só a contagem por data/tipo/valor, sem dar acesso ao lançamento original para comparação.
4. Ao confirmar revisão, a tela volta para o primeiro registro da página em vez de avançar.
5. O usuário não vê quantas pendências seriam afetadas pelo botão `Aplicar às semelhantes`.

## Correções desta branch
- **Paginação:** 50 registros por página, `OFFSET` e contador absoluto `posição de total pendente`, navegação anterior/próxima entre todas as páginas, sem truncar a fila; SQL limitado a páginas para não sobrecarregar o celular.
- **Comparação contextual:** o botão `Comparar com o Mototrack` mostra um cartão do CSV, mais os lançamentos **já existentes no Mototrack** com mesma data, tipo e centavos: origem, título, data, valor, categoria e distância, quando houver. Não se presume igualdade a partir desses campos.
- **Categoria em rascunho:** ao navegar pelo botão `Salvar e próxima` ou `Anterior`, a escolha fica registrada em `bank_import_rows.category` mesmo com status `pending`, não é lançada no dashboard e volta ao revisitar o registro.
- **Segurança nas decisões em lote:** mostra quantidade do grupo e exige confirmação explícita quando a decisão afetará mais de um registro; importações em lote com possíveis duplicatas permanecem bloqueadas pelo núcleo SQL.
- **Fluxo contínuo:** após aprovar uma movimentação, a tela segue da posição atual na lista (o próximo item ocupa a posição do revisado), em vez de voltar sempre ao início.
- **Categorias de estabelecimentos:** aceita `SUPERMERCADOS` e `MERCADOS` no plural como **sugestão** de alimentação, sem lançar automaticamente.

## O que cada ação significa
- `Importar no Mototrack`: cria uma transação do aplicativo.
- `Transferência`: reconhece a movimentação bancária como transferência e **não** cria transação financeira no Mototrack. Útil para movimentação entre contas próprias quando o objetivo é evitar dupla contagem, não para omitir despesas de cartão ainda não registradas.
- `Ignorar`: marca a movimentação como ignorada e não cria transação.
- `Salvar e próxima`: **não aprova nem ignora**, apenas guarda a categoria e muda para a próxima; o item permanece pendente.
- `Lembrar decisão`: salva regra por chave de origem/estabelecimento/tipo para sugestão futura, sem aplicação automática.
- `Aplicar às semelhantes`: afeta somente pendentes com o mesmo merchantKey e tipo; cuidado especial ao ignorar lotes.

## O que os testes verificam
- 135 itens alcançáveis, divididos em páginas de 50/50/35, sem repetição/perda.
- Categorias de rascunho persistentes, sem criar transações antes da confirmação.
- Comparação retorna dados reais da transação existente no SQLite e categorias.
- Contagem de pendências do mesmo estabelecimento, sem misturar estabelecimentos diferentes.
- Suítes anteriores continuam rodando.

## Limitações que permanecem
- A heurística de possível duplicata continua exigindo correspondência exata de data/tipo/valor. Diferenças em descrição, data de compensação ou arredondamento não são identificadas automaticamente.
- A confirmação `Importar mesmo assim` continua possível após comparação: o usuário decide; o sistema não apaga o original.
- `Salvar e próxima` guarda a **categoria**, não a marcação das opções `Aplicar semelhantes` ou `Lembrar decisão`, que só se efetivam mediante ação definitiva.
- O contador total representa **pendentes no banco**, não a quantidade original do CSV.
- QA visual no Android com extratos fictícios e dispositivos de diferentes tamanhos ainda é necessário.

## Antes de atualizar a build de testes
Exportar um **backup v2** pelo Mototrack (Teste) e salvar uma cópia fora do aparelho. A variante de teste tem o mesmo identificador da build anterior; atualizar o APK pode preservar e migrar o banco, mas sempre é melhor ter cópia de recuperação. Não usar o backup v1 antigo como única proteção de filas/regras novas.
