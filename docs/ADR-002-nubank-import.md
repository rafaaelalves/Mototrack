# Importação de extratos Nubank — MVP funcional (conta corrente)

**Branch:** `feat/nubank-csv-import` · **Base:** `integration/phase0` (PR #11, ainda não mesclado).
**Status:** implementação inicial para revisão/QA. Não liberar a usuários com dados únicos sem testes no Android.

## Objetivo

Popular o Mototrack a partir de CSV da **conta Nubank**, sem digitar manualmente centenas de lançamentos, com confirmação do usuário e proteção contra duplicações. A importação ajuda no histórico do aplicativo, mas não transforma automaticamente Pix, salário ou pagamento de fatura em lucro de entregas.

## Formato validado com extratos reais enviados pelo titular

`Data,Valor,Identificador,Descrição`

- Data em `DD/MM/AAAA`.
- Valor com sinal e ponto decimal, como `-25.90` e `119.00`.
- Identificador estável por movimentação, utilizado na chave `(source, sourceId)`.
- Descrição textual pode conter nome de banco, CPF/CNPJ, agência/conta e vírgulas entre aspas.
- O app retém **descrição resumida**, categoria, identificador, data e centavos; não armazena o arquivo CSV original no banco.
- CSV de **fatura do cartão** (colunas `date,title,amount`) é rejeitado com instrução específica. Sem assumir sinais ou parcelas de cartão.

## Fluxo de usuário

1. `Configurações → Importar e revisar CSV`.
2. Selecionar arquivo da conta via DocumentPicker; validação integral **antes** da gravação.
3. Importação cria registros `pending` na fila SQLite v2; o dashboard permanece inalterado.
4. Mesmo ID exportado outra vez não gera novo registro. Conflitos de IDs com campos divergentes bloqueiam o lote.
5. Revisão por movimentação com data, tipo, valor, descrição sanitizada, sugestões e alerta de coincidência com transação manual.
6. Escolher uma ação: **importar**, **transferência** (não conta em receitas/despesas), **ignorar** (não conta) ou **adiar** (continua pendente).
7. Categorias de entradas são obrigatórias e não são inferidas automaticamente. Regras e heurísticas sugerem, sem lançar nada sem confirmação.
8. Marcar `aplicar às semelhantes` para registros pendentes com **mesmo merchantKey e direção**; opcionalmente lembrar a escolha como regra para importações futuras.
9. Permitir desfazer a última decisão em lote, se as transações geradas ainda não tiverem sido editadas; desfazendo a importação, o registro é excluído **logicamente**, nunca removido permanentemente.

## Modelo SQLite (user_version = 2)

- `bank_import_rows`: origem, ID externo, data, tipo, centavos, descrição resumida, chave de estabelecimento/destinatário, estado, categoria e ID da transação gerada.
- `bank_import_rules`: combinação exata de origem, merchantKey e direção; ação e categoria decididas pelo usuário.
- `transactions`: continua sendo o único conjunto que alimenta os indicadores. Pendentes, ignorados e transferências **não** viram transações.
- Novas migrações são transacionais e não eliminam lançamentos anteriores.

## Proteções financeiras

- Pix recebidos **não** viram automaticamente entregas ou salário. Podem ser transferências próprias, reembolsos ou receita real.
- Pagamento de cartão sugere **transferência**, sem forçar isso: se as compras do cartão não estão lançadas, ignorar a fatura omitiria despesas.
- Estornos não são automaticamente nova receita; usuário decide.
- Sugestões de categoria (posto, mercado, farmácia, Mottu) são apenas palpites controlados.
- Duplicata pelo mesmo identificador bancário é bloqueada; coincidência de **data + tipo + valor** com transação manual gera alerta, mas não assume que sejam a mesma compra.
- Valores em centavos inteiros, datas validadas e CSV inteiro rejeitado se um registro estiver malformado. Reimportar período sobreposto é seguro para IDs idênticos.
- Restauração de transações é transacional; aprovação de importação também deve rodar em transação exclusiva no dispositivo.

## Privacidade

Os exemplos de testes são inteiramente fictícios, sem nomes reais, transações, CPFs, CNPJs ou contas bancárias. Nenhum extrato do titular foi versionado. O CSV é lido localmente, não é transmitido pelo aplicativo e o arquivo original não é gravado pelo importador em armazenamento permanente.

## Backup JSON v2 e restauração

O exportador grava **versão 2** incluindo `transactions`, `bankImportRows` e `bankImportRules`. Antes de substituir o banco, a restauração valida registros, IDs, referências entre tabelas, categorias, versões e regras duplicadas. As substituições ocorrem numa única transação SQL, com cópia de recuperação local gerada e verificada antes da escrita.

Backups **v1 antigos continuam aceitos**. Como não possuem filas nem regras, ao restaurá-los essas informações não existem no backup e não podem ser recuperadas dele. O aplicativo avisa antes de continuar e gera uma cópia v2 do estado atual. Um ID bancário é salvo na nota das transações aprovadas, permitindo reconstruir o estado importado caso o CSV seja reprocessado após uma restauração v1.

A cópia local deve ser compartilhada com um armazenamento fora do aplicativo para sobreviver a uma desinstalação. Importar extrato e restaurar backup são operações diferentes; importar CSV nunca apaga o banco.

## Verificações automatizadas

- Parser CSV: caracteres especiais, BOM, aspas, vírgulas internas, CRLF, datas reais, centavos, formato de fatura, repetição de identificadores, recomendações sem inferir Pix.
- SQLite real do Node: staging, importação sem afetar dashboard, conflito/rollback, regras exatas, classificação, transferência, desfazer e reconstrução de origem.
- CI TypeScript e `npm run test:unit` devem estar verdes na branch.

## QA pendente (Android)

- Banco v1 real com **dados fictícios**, migração para v2 e reinício.
- Importar ao menos dois CSVs sobrepostos, reimportá-los e verificar contagens.
- Confirmar que os lançamentos aprovados aparecem no dashboard e pendentes não aparecem.
- Revisar categorias e regras de estabelecimentos repetidos; desfazer após decisão em lote e edição manual.
- Validar navegação, texto longo, arquivo com 500+ linhas, erro em linha intermediária, abertura via provedor de arquivos e desempenho.
- Conferir backup v2, restauração e reimportação antes de testar com dados pessoais.

## Próximas iterações

1. Listagem com filtros e busca, reclassificação de ignorados, gestão de regras (editar/excluir).
2. Importação de **fatura do cartão** com data, competência, parcelamentos, estornos e conciliação com pagamento da fatura, sem dupla contagem.
3. Detecção assistida de possíveis duplicatas manuais (heurística revisável, nunca exclusão automática).
4. Identificação de operações entre contas próprias, reembolsos e repasses de plataformas com opção de conciliação.
5. Importação de OFX e outros bancos mediante módulos específicos (não presumir universalidade do CSV).

**Não sugerimos integração bancária via credenciais nem coleta de senha.**
