# ADR-003 — Lotes de extrato e aprendizado de categorias

**Estado:** implementação experimental, branch `feat/nubank-review-batches-and-learning`, baseada em `fix/nubank-review-flow`. Não integrada à `develop`.

## Problemas observados no uso real
- Um arquivo antigo de maio foi importado apenas para teste e deixou centenas de pendências. O usuário quer abandonar **aquele extrato**, não apagar o histórico financeiro.
- `Aplicar às semelhantes` usava a chave completa `merchantKey` para importar/ignorar, portanto `DEBIT:OXXO` e `DEBIT:OXXO PISCINAS` não eram um grupo.
- Escolher Alimentação deveria poder **categorizá-las** sem, necessariamente, importar todas nem duplicar lançamentos já registrados.
- O histórico manual (ex.: Oxxo, Claro, Salário) contém nomes e categorias reutilizáveis, mas o cadastro atual não sugeria opções.

## Decisões

### 1. Abandonar somente as pendências de um lote
Cada importação de CSV já atribui um mesmo `createdAt` a suas novas linhas `bank_import_rows`. A versão atual utiliza esse identificador de lote preexistente, **sem adicionar migração**, agrupando por instante de importação, data mínima/máxima e contagens.

`Gerenciar extratos` permite descartar **apenas linhas ainda `pending`** daquele lote, após informar:
- intervalo de datas das movimentações;
- quantidade de pendências a descartar;
- quantidade de decisões concluídas que será preservada.

A operação é transacional; não exclui lançamentos aprovados em `transactions`, regras aprendidas nem lançamentos manuais. Permite reimportar as pendências descartadas pelo CSV original. **Não é uma reversão de aprovações já feitas.** O backup v2 já inclui `createdAt` de todas as movimentações. Limitação: lotes coincidentes no mesmo milissegundo podem compartilhar o agrupamento; um ID de lote explícito pode ser adotado em migração futura.

### 2. Classificar sem confirmar
Separar:
- **Categoria em lote:** escreve apenas `category` nas movimentações `pending` e `category IS NULL`; nenhuma transação nova entra no dashboard.
- **Aplicar decisão às semelhantes:** comportamento anterior de importar, ignorar ou marcar transferência para grupo **exato**, com confirmação e proteções de duplicata.

Há dois alcances de categorização:
- **Descrição idêntica:** `merchantKey` exata.
- **Variações da marca:** para débitos reconhecidos e prefixos não genéricos, como `DEBIT:OXXO PISCINAS` → `DEBIT:OXXO`, inclui `DEBIT:OXXO CAMBUI` e `DEBIT:OXXO`.

Não agrupar Pix por esse método, nem nomes genéricos como `MERCADO`, `SUPERMERCADO`, `POSTO`, `FARMACIA`. O usuário vê quantidade e amostra de nomes e confirma. A operação **preserva categorias já escolhidas** e nunca confirma a importação.

### 3. Sugestões derivadas de lançamentos existentes
Ler títulos e categorias já registrados no SQLite:
- Sugestão conservadora por prefixo normalizado: `Oxxo` histórico pode sugerir Alimentação em `Oxxo Piscinas`.
- Se o histórico da mesma família tiver categorias divergentes, não sugerir unilateralmente.
- A sugestão não aprova nem cria transação; ela preenche categoria editável, e o usuário pode confirmar, alterar ou adiar.
- A tela **Novo lançamento** oferece autocomplete local após dois caracteres: tocar em título sugerido preenche nome e categoria anteriores, sem salvar automaticamente.
- Não recolher credenciais, dados externos, embeddings, modelos online ou perfil remoto.

### 4. O que não é duplicata
Continuam separados:
- ID bancário idêntico: duplicata exata de importação, bloqueada.
- Mesma data/tipo/valor: apenas **possível** duplicata manual; comparar títulos e decidir.
- Mesmo estabelecimento/família: sugestão de **categoria**, não prova de que é a mesma transação.

## Limitações e evolução
- Os agrupamentos por `createdAt` representam sessões de importação, não um identificador formal v3 de lote. Evitar cancelamentos concomitantes na versão de teste.
- Descartar pendências não desfaz aprovações já feitas. Uma reversão de lotes completos exige validar edições posteriores, backups e a origem de regras.
- Classificar 50 compras como Alimentação não resolve, por si só, se 30 já existem no backup antigo; é necessário reconciliação segura de possíveis duplicatas.
- A categoria atual `other` é genérica para Claro/telefonia. Recomenda-se avaliar **categorias personalizadas** ou uma categoria de comunicação na próxima evolução, ao invés de classificá-la automaticamente sem escolha.
- Criar gestão visual de aliases ("Oxxo" = "Oxxo Piscinas") com exceções e possibilidade de revisar/remover regras será a próxima evolução se o agrupamento por prefixo se revelar insuficiente.
- O nome do CSV não é armazenado; os lotes antigos são identificados pelo intervalo de datas e hora da importação.

## QA
- Abrir build de teste já com maio e agosto na fila; conferir que cada arquivo aparece separadamente e a soma das pendências confere.
- Exportar backup JSON v2 antes de qualquer descarte.
- Descartar apenas pendências de maio, confirmar que agosto permanece e que os lançamentos já aprovados não mudam.
- Reimportar maio, observar identificadores reconhecidos/pendências recriadas.
- Escolher Oxxo e classificar variações, conferir que `Oxxo Piscinas` e `Oxxo Cambuí` recebem a categoria, mas permanecem pendentes.
- Testar nomes genéricos, grupos com categoria previamente atribuída e casos de duplicata manual.
- Cadastro manual: digitar `Oxx`, selecionar sugestão anterior e conferir preenchimento de título e categoria.
- Verificar documentação e CI; exigir teste visual no Android antes de merge.

**Nenhum dado financeiro real foi adicionado ao repositório.** Todos os testes usam registros fictícios.
