# Como testar a importação Nubank em Android

## Instalação segura (recomendada)

A partir deste branch `feat/nubank-csv-import`, o perfil `preview-test` produz um APK
separado chamado **Mototrack (Teste)**, com package Android
`com.rafah_as9.mototrack.test`. Ele pode ser instalado sem sobrescrever o
Mototrack normal (`com.rafah_as9.Mototrack`).

1. No computador, abra um terminal na pasta do repositório e atualize a branch:

```bash
git fetch origin
git switch feat/nubank-csv-import
git pull --ff-only origin feat/nubank-csv-import
npm ci
npm run test:unit
npx tsc --noEmit
```

2. Faça login no EAS se for necessário, com a conta Expo que tem acesso ao projeto:

```bash
npx eas-cli login
npx eas-cli build --platform android --profile preview-test
```

3. O serviço Expo gera um link para instalar o **APK de teste**. Confirme que o
nome do aplicativo é `Mototrack (Teste)` antes de abrir. Se pedir a criação
de credenciais de assinatura para o novo package, aceite apenas na conta Expo
correta. Não use perfil `production` nem `preview` para este teste isolado.

4. Em **Configurações → Importar e revisar CSV**, escolha o CSV **da conta
Nubank**, não o da fatura do cartão. Comece com um CSV de poucos registros
fictícios, depois teste um extrato real apenas se estiver confortável.

## Cenários mínimos para registrar o resultado

- Abrir app recém-instalado com banco vazio.
- Importar extrato válido: nenhuma transação entra no dashboard antes da revisão.
- Repetir o mesmo CSV: zero itens duplicados; pendências permanecem.
- Importar registro de entrada: exigir categoria (salário/entrega/receita única).
- Marcar transferência e ignorar; nenhuma vira receita/despesa.
- Salvar regra e importar CSV posterior de mesmo destinatário; mostrar sugestão,
  mas exigir confirmação.
- Testar `aplicar às semelhantes` e `desfazer`, incluindo proteção contra
  duplicação manual.
- Exportar backup **v2**. Confirmar que contém (em arquivo local protegido)
  `transactions`, `bankImportRows` e `bankImportRules`.
- Restaurar backup v2 no **app de teste** somente após salvar cópia fora dele,
  conferir os registros e reimportar o CSV para verificar deduplicação.
- Testar arquivo de fatura (`date,title,amount`): deve ser rejeitado
  amigavelmente, sem escrever no banco.

## Advertências

- **Build passa no Node não é garantia de que o APK inicia nem que a tela funciona**.
  O objetivo do teste no aparelho é descobrir exatamente isso.
- Um APK `preview` comum usa o identificador do Mototrack normal e pode
  substituir a instalação anterior. Use **somente `preview-test`** nesta etapa.
- O banco de teste é independente do banco original; isso também significa que
  não testa a migração in-place de dados reais do aplicativo antigo. Ela exige
  teste específico com uma cópia controlada do banco.
- Os extratos contêm informações financeiras sensíveis: não commitá-los no
  GitHub. O importador trabalha localmente e os backups devem ficar em
  armazenamento protegido.
- Não desinstale o app original para instalar a variante de teste.
