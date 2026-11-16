# Roadmap de evolução do Mototrack

**Estado:** proposta registrada em 15/11/2026 e execução iniciada na branch `chore/phase0-data-foundation`. O plano não significa que as funcionalidades estejam prontas.

## Fonte de verdade
- Branch de integração: `develop`. `master` não contém os PRs #5 e #6, já incorporados em `develop`.
- Projeto: **controle operacional e rentabilidade de entregas**, sem importar dados bancários pessoais do estudo `Financas_Pessoais`.
- Princípio: preservar dados do SQLite, trabalhar em PRs pequenos e não gerar builds desnecessárias.

## Fase 0 — estabilização
- [x] Inventariar o código e registrar decisões e prioridades.
- [x] Criar branch de trabalho baseada em `develop`.
- [x] Propor adoção inicial de migrações explícitas, com preservação da tabela existente (neste PR; revisão e QA pendentes).
- [ ] Verificar migrações no Android com banco novo, legado, atualizado e com versão futura.
- [ ] Validar formato do backup integralmente antes de qualquer operação de escrita.
- [ ] Proteger a restauração com atomicidade e confirmação clara; criar cópia de segurança pré-restauração.
- [ ] Introduzir testes automatizados de domínio, persistência e projeção.
- [ ] Corrigir métricas e nomenclatura do dashboard quando forem enganosas: quilometragem, lucro, melhor loja/dia, donut de categorias.
- [ ] Planejar consolidação de `develop` em `master` apenas após QA; **não** fazer merge automaticamente.

## Fase 1 — domínio operacional
- [ ] Entidade `WorkShift`: plataforma, estação, veículo, data, início/fim, distância e status.
- [ ] Entradas por turno, garantia, excedentes e número de entregas; pagamentos pendentes vs recebidos.
- [ ] Entidade `Vehicle` com perfis FZ25, alugada ou própria, sem hardcode de valores pessoais.
- [ ] `FuelEntry` e medição entre abastecimentos completos.
- [ ] `MaintenanceRecord`, revisões por km/tempo e reserva distinta do desembolso real.
- [ ] Métricas de receita bruta, margem operacional e lucro econômico **sem dupla contagem**.

## Fase 2 — decisão e previsões
- [ ] Rentabilidade por estabelecimento, região, plataforma e hora, controlando tamanho da amostra.
- [ ] Custos da ida e volta, retorno vazio, deslocamento CLT e uso pessoal separados.
- [ ] Projeções baseadas em turnos disponíveis/realizados e histórico, sem multiplicar receita de fins de semana por 30 dias.
- [ ] Metas mensais com faixas conservadora/base/favorável e eventos futuros identificados.

## Fase 3 — UX e acesso multiplataforma
- [ ] Registro rápido de turno, revisão das telas e gráficos com legendas inequívocas.
- [ ] Avaliar suporte Expo Web e extração de domínio compartilhado antes de reescrever app para PC.
- [ ] Exportação CSV/JSON robusta; sincronização só se justificada.

## Fase 4 — integrações
- [ ] Investigar FZ Companion e telemetria da Yamaha **após** comprovar disponibilidade técnica.
- [ ] Integrações opt-in com plataformas de entregas, apenas por interfaces e permissões adequadas.

## Critérios de aceite comuns
1. Cálculo financeiro com testes e valores monetários em centavos.
2. Dados antigos preservados; migrações reversíveis por backup.
3. Distância desconhecida = **desconhecida**, jamais zero implicitamente.
4. Recebido, a receber, receita fixa e receita variável diferenciados.
5. Funciona offline no celular; import/export sem depender de conta.
6. Nenhum holerite, extrato, CPF ou dado pessoal real versionado.
7. Um PR pequeno por assunto, com registro do teste executado e riscos remanescentes.

## Histórico de execução — 15/11/2026

Cada alteração permanece em **Draft**, separada e sem merge na `develop`. A validação automatizada não equivale a QA visual/Android.

| PR | Entrega | Testes |
|---|---|---|
| [#7](https://github.com/rafaaelalves/Mototrack/pull/7) | Migrações versionadas de SQLite e documentação | SQL Node + TypeScript, CI aprovado |
| [#8](https://github.com/rafaaelalves/Mototrack/pull/8) | Backup com validação, restauração transacional e cópia de recuperação | Testes unitários + TypeScript, CI aprovado |
| [#9](https://github.com/rafaaelalves/Mototrack/pull/9) | Gráfico de despesas completo e nomenclatura honesta de indicadores | 6 testes de agrupamento + TypeScript, CI aprovado |
| [#10](https://github.com/rafaaelalves/Mototrack/pull/10) | Projeção limitada à receita de entregas, sem prever despesa pontual ou saldo bancário fictício | 7 testes de projeção + TypeScript, CI aprovado |

**Importante:** #7, #8, #9 e #10 partem independentemente de `develop` e cada um introduz seu próprio comando de teste e workflow de CI. Ao integrar, reconciliar uma única configuração de testes e conferir compatibilidade com o conjunto. Não misturar branches em massa sem revisão.

**Próximos passos:** verificar compatibilidade combinada; QA de banco/restauração com dados fictícios no Android; conferir o dashboard visualmente; então considerar finalização da Fase 0 e desenho das entidades da Fase 1.
