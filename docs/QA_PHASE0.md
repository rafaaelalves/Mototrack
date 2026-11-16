# Checklist de QA — primeira migração do SQLite

**Status:** testes SQL automatizados adicionados em `tests/migrations.test.mjs` usando SQLite real do Node 22. A execução no Android/Expo ainda está pendente. Não considerar o teste Node como substituto de QA de aparelho.

## Casos obrigatórios
1. **Banco vazio:** instalação nova cria `transactions` com todas as colunas; `PRAGMA user_version` retorna 1; inserir e listar transações normalmente.
2. **Banco atual:** base de dados real com `user_version = 0` e schema completo mantém total, IDs, títulos, datas, centavos, categorias e `deletedAt` inalterados.
3. **Banco legado:** versão 0 com colunas essenciais e sem `updatedAt`/`deletedAt` recebe colunas ausentes; `updatedAt` herdado de `createdAt`; nenhum lançamento perdido.
4. **Inicialização repetida:** reiniciar depois da migração não modifica lançamentos, número de colunas ou versão.
5. **Versão desconhecida:** `user_version > 1` falha com erro explícito e **não apaga nada**.
6. **Esquema incompatível:** tabela existente sem campo essencial falha de maneira clara e sem exclusão.
7. **Interrupção/erro durante migração:** transação SQL é revertida; versão e registros permanecem coerentes.
8. **Regressão do app:** navegar dashboard, editar/apagar lançamento, filtrar, exportar/visualizar backup.

## Como verificar
- Fazer **backup manual válido e salvo fora do aparelho** antes de testar com registros reais.
- Começar por banco fictício (incluindo dados de versão 0), não pelo único backup pessoal existente.
- Conferir `PRAGMA table_info(transactions)`, `PRAGMA user_version` e contagens antes/depois.
- Após migração e reinício, conferir import/export sem executá-lo sobre dados únicos.

## Risco remanescente
A primeira mudança cobre **somente migrações**. A lógica atual de importação JSON que substitui todos os lançamentos ainda precisa ser reforçada, em PR seguinte. Não realizar restauração destrutiva sobre dados únicos antes desse trabalho.

## Testes automáticos disponíveis
```sh
npm ci
npm run test:unit
npx tsc --noEmit
```
A suíte cobre criação do banco, migração legado, idempotência, recusa de versões futuras/esquemas incompatíveis e rollback transacional sob erro SQL. A API Expo ainda precisa ser exercitada no Android.
