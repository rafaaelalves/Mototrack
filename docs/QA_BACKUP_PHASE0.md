# QA do backup e restauração (Fase 0)

## Garantias implementadas neste PR
- Versão 1 aceita, versões não suportadas rejeitadas.
- Todos os lançamentos são validados **antes** de apagar os dados existentes: ID, data, tipo, centavos, categoria, distância e campos opcionais.
- Legado v1 sem `updatedAt`, `deletedAt`, `notes`, `category` ou `distanceMeters` é normalizado sem apagar lançamentos.
- IDs repetidos, datas impossíveis, categoria incompatível, distância negativa e valores não inteiros são rejeitados.
- Arquivo sem transações **não** pode apagar banco que já tem transações.
- Backup de recuperação é criado localmente e relido antes de começar a substituir os dados.
- No Android/iOS, a substituição é transacional com `withExclusiveTransactionAsync`: falha num INSERT reverte o DELETE. Na web, o Expo não oferece essa transação exclusiva e usa-se a transação comum; a restauração web deverá ter QA separado.
- O backup contém inclusive transações excluídas logicamente, preservando a possibilidade de recuperação completa.

## Como executar testes de validação, sem celular
```sh
npm ci
npm run test:unit
npx tsc --noEmit
```
Node 22+ é necessário para remover tipos TypeScript no test runner sem ferramentas extras.

## QA ainda obrigatório no dispositivo
1. Crie um banco **fictício**, insira lançamentos, registre IDs e totais, exporte backup; restaure com dados de teste e confira integridade.
2. Corrompa um backup (valor negativo, data impossível, duplicar ID), tente importar e verifique que o banco não mudou.
3. Simule falha durante restauração (por exemplo constraint no banco de teste) e verifique rollback completo.
4. Verifique que o arquivo `mototrack-antes-de-restaurar-*.json` ficou salvo antes do processo e que pode ser compartilhado.
5. Teste backup v1 mais antigo sem campos opcionais.
6. Verifique datas, categorias, distância, valores e registros excluídos antes e depois.
7. Reinicie o aplicativo e confira que os dados restaurados continuam íntegros.
8. **Não** testar restauração destrutiva no único banco/backup pessoal.

## Limitações / decisões futuras
- As categorias são verificadas contra os identificadores atualmente conhecidos. Antes de acrescentar novas categorias, atualizar esta validação (ou centralizar a lista).
- Não há criptografia integrada do backup local: o JSON deve ser guardado em armazenamento protegido.
- A cópia de recuperação local não sobrevive necessariamente à desinstalação do app; exporte uma cópia externa.
- O teste unitário verifica a validação pura. Testes com SQLite real ainda precisam ser adicionados/executados.
- Esta etapa não introduz servidor, conta ou sincronização em nuvem.
