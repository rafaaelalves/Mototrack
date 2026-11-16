# ADR-001 — fronteiras de domínio e preservação de dados

**Status:** proposta aceita para orientar o desenvolvimento; implementação incremental.

### Problema
A versão atual usa `transactions` para representar entrada, saída e km de entregas. Isso não distingue duração do turno, deslocamento à estação, quilometragem do CLT, veículo, garantia e repasse. O estudo financeiro demonstrou que misturar essas grandezas leva a conclusões equivocadas.

### Decisão
- Preservar `transactions` e seus dados; não adicionar todos os campos futuros a uma única tabela.
- Criar entidades próprias, em etapas: `WorkShift`, `Vehicle`, `FuelEntry`, `MaintenanceRecord`, `Payout`.
- Transação financeira não é equivalente a turno nem a pagamento confirmado. As entidades terão relacionamentos explícitos, com migração cuidadosa.
- Separar custo de combustível e desgaste **provisionado** de despesas efetivamente pagas; parcela de financiamento não equivale a custo variável de uma entrega.
- Preservar categorias `salary`, `delivery`, `one_off` já existentes em `develop`; não incluir salário nas métricas operacionais.
- Dados pessoais do estudo privado `Financas_Pessoais` **não** vão para Mototrack público. Usar fixtures fictícias.
- `null` representa informação ainda não coletada; não converter km, litros ou horas desconhecidos em zero.

### Compatibilidade
Banco existente chama-se `painel_v2.db`. A primeira migração explícita adota `PRAGMA user_version = 1` sem renomear nem apagar o banco e tolera as colunas legadas opcionais. Novas tabelas deverão entrar em novas versões de migração.

### Próxima revisão
Antes de construir `WorkShift`, avaliar modelo de eventos/recebimentos e seu impacto nos gráficos e no backup.
