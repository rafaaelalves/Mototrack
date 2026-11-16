# Integração da Fase 0 — verificação conjunta

**Branch:** `integration/phase0`, derivada de `develop`. Reúne código dos PRs #7, #8, #9 e #10, sem alterar os PRs originais ou a `develop`.

## Composição
- **#7:** migração SQLite versionada e testes.
- **#8:** validação do backup, cópia antes da restauração e restauração transacional.
- **#9:** donut com categorias restantes agrupadas e indicadores sem inferir rentabilidade.
- **#10:** somente renda variável registrada é extrapolada; não inventar despesas ou saldo futuro.
- **Conflito resolvido:** `app/index.tsx` combina o painel de categorias do #9 e a projeção de entregas do #10.
- **Consolidação:** um script de testes no `package.json` e um workflow de CI cobrindo as quatro suítes.

## Critérios para aprovação
1. CI `tsc --noEmit` e testes Node/SQLite aprovados neste conjunto.
2. Banco novo e upgrade legado com dados fictícios testados no Android.
3. Importar/exportar backup e verificar rollback em falha no dispositivo, com cópia guardada fora do aparelho.
4. Dashboard visualmente conferido no mês atual/anterior, sem dados e com categorias minoritárias.
5. Métricas expressam claramente **resultado registrado**, **receita estimada** e **saldo bancário** como grandezas diferentes.
6. Nenhum teste destrutivo deve utilizar o único banco real do usuário.

## Riscos ainda conhecidos
- Testes com SQLite do Node não substituem `expo-sqlite` em Android/iOS.
- A restauração web usa transação comum e requer QA específico antes de ser considerada segura.
- Não há ainda entidades de turnos, veículos e agendamentos.
- Os quatro PRs independentes têm scripts e workflows similares. Este PR integra uma única configuração, evitando duplicação.

## Decisão de integração
Manter o PR da integração em **Draft** até QA. Para levar à `develop`, decidir uma via de merge evitando aplicar os quatro PRs paralelamente sem revisão. `master` permanece intacta.

## Testes cruzados adicionados na integração

Além das suítes de cada PR, `tests/phase0-integration.test.mjs` executa o SQLite real do Node 22 e cobre:

1. Criação de banco + migração + restauração de dados com centavos, categoria, quilômetros e exclusão lógica preservados.
2. Migração de tabela antiga e aceitação de backup v1 sem campos opcionais.
3. Falha provocada durante INSERT, com rollback preservando todos os registros anteriores.
4. Bloqueio de backup vazio ao tentar substituir banco com registros.
5. Rejeição de backup inválido e de IDs duplicados antes de qualquer escrita.

O núcleo SQL da restauração foi isolado em `src/db/restoreCore.ts` e chamado pela rotina Android/iOS dentro da transação exclusiva do Expo. A CI verificou TypeScript e o conjunto de testes Node/SQLite. **Isso não comprova o comportamento do sistema de arquivos ou das transações exclusivas no Android real.**

### Falha detectada durante a integração

Uma revisão intermediária removeu involuntariamente a função de exportação `buildBackup`. O compilador TypeScript detectou a regressão no CI e a função foi restaurada antes de considerar o conjunto validado. Os registros finais de CI devem ser verificados no PR #11; resultados de commits intermediários não representam a versão final.

### Rótulo ajustado

`Dia da semana (receita)` descreve a soma agrupada por dia da semana — **não** lucro por turno nem receita de uma data específica. A comparação por estabelecimento permanece limitada aos títulos livres.
