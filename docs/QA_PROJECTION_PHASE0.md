# Fase 0 — projeções com semântica explícita

## Problema observado
Antes desta alteração, `calculateMonthlyProjection` extrapolava **todas** as despesas acumuladas para os dias restantes do mês, incluindo pagamentos episódicos, como uma revisão da moto. No dashboard, a diferença entre receita e despesas extrapoladas aparecia como `saldo estimado`, apesar de não existir informação sobre salário futuro, turnos agendados nem vencimentos do usuário.

## Mudança deste PR
- A extrapolação linear passa a atingir **somente entradas já classificadas como renda de entregas**.
- Salário e receitas únicas entram apenas pelo montante efetivamente registrado.
- Despesas são mantidas como **observadas**, sem previsão especulativa de gastos futuros.
- A projeção de resultado/saldo do mês é **removida do painel** até termos um calendário de turnos e vencimentos.
- O cartão do dashboard passa a apresentar `Entregas (estim.)` no mês atual, ou `Entregas realizadas` em meses encerrados.
- O gráfico mantém despesas **efetivamente realizadas**, sem linha pontilhada de despesas futuras. A linha pontilhada de entrada usa apenas a média diária de entregas já registradas para crescer a partir do total de entradas observadas.
- Regras numéricas foram isoladas em `src/domain/projectionCore.ts`, verificáveis sem ambiente Expo.

## O que não foi implementado
Não inferimos um agendamento de entregas, a quantidade de fins de semana restantes ou salário que ainda não foi pago. A extrapolação permanece um **indicador de tendência**, não um compromisso de receita. Não há ainda previsão confiável de saldo bancário ou lucro líquido final.

## Verificações
`tests/projection-core.test.mjs` cobre salários não extrapolados, revisão não multiplicada, mês encerrado, receita sem categoria, ausência de dados, arredondamento em centavos e entradas inválidas.

QA pendente: conferir no Android apresentação do cartão e gráfico em mês atual, passado, com poucas entradas e com apenas despesas. Não usar dados financeiros pessoais nos testes.
