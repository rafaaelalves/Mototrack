# Fase 0 — clareza dos indicadores financeiros

## O que foi corrigido
- O gráfico de categorias antes selecionava quatro categorias e descartava as demais, recalculando as proporções sobre um subconjunto de despesas. A partir desta versão, apresenta as três maiores categorias e um setor "Outras categorias" com o valor agregado restante.
- "Melhor dia" descrevia o maior total de receitas **agrupadas por dia da semana**, não margem por hora/turno. O rótulo passa a "Maior receita por dia".
- "Melhor loja" era o título livre digitado mais rentável em *faturamento bruto acumulado*; passa a "Maior receita por título" para não inferir identificação de estabelecimento ou lucro.
- "Saldo" de entradas menos saídas passa a "Resultado", porque não é saldo bancário com posição inicial, conciliação ou valores a receber.

## Por que é uma correção, e não uma nova funcionalidade
As métricas não ganharam dados novos: continuamos usando lançamentos existentes. O objetivo é não induzir decisões incorretas enquanto não há modelos próprios de turno, pagamento, veículo e quilometragem.

## QA automatizado
`tests/expense-breakdown.test.mjs` testa preservação dos totais, agrupamento, ordenação, exclusão de categorias sem despesa e ausência de mutação da lista de entrada.

## Limitações
- A receita por dia é **acumulada por dia da semana**, não média por sessão, hora ou entrega.
- Um título textual arbitrário não é um identificador confiável de restaurante/estação; isso mudará com `WorkShift`.
- A projeção mensal ainda extrapola despesas como se fossem diárias. Corrigi-la requer contrato de previsão explícito; não será tratada como resolvida por este PR.
- Alterações no dashboard ainda necessitam conferência visual num celular antes de merge.
