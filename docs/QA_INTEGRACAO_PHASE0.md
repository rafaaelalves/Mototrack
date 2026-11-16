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
