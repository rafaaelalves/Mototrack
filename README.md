# Mototrack – Controle financeiro para motoboys 🏍💸

App mobile feito com **React Native + Expo** para acompanhar ganhos, gastos e quilometragem de forma simples, visual e offline.  
Pensado para **motoboys e entregadores**, mas útil para qualquer controle financeiro mensal.

---

## ✨ Funcionalidades

### 💰 Financeiro mensal

- Resumo do mês: **Entradas, Saídas e Saldo**.
- Navegação por meses (anterior/próximo), sem avançar para meses futuros.
- Lançamentos de **entrada** e **saída** com:
  - valor em reais (armazenado em centavos),
  - título,
  - data,
  - notas opcionais,
  - edição e exclusão.

### 🏷 Categorias & KM

- Despesas categorizadas em:
  - **Combustível**, **Alimentação**, **Manutenção**, **Outros** (ou sem categoria).
- Campo opcional de **KM rodados** em lançamentos de **entrada**.
- Quilometragem armazenada em metros (`distanceMeters`) para facilitar cálculos.

### 📊 Estatísticas do mês

- Total de **Entradas**, **Saídas** e **Saldo**.
- **KM no mês** (soma de todos os distanceMeters).
- **Custo por km** (R$/km com base nos gastos).
- **R$/km (saldo)** – quanto sobra por km rodado.
- Tela em formato de **bottom sheet** com:
  - cards em grid,
  - pager horizontal (2 páginas: visão geral e por categoria),
  - indicador de página (dots).

### 🔎 Detalhe da transação

- Tela dedicada para ver melhor cada lançamento:
  - data, tipo, valor, categoria, KM e notas.
- Atalhos para **editar** ou **excluir** o lançamento.

### 🎨 UI / UX

- Tema escuro com:
  - background roxo + **glow elíptico** em laranja usando `react-native-svg`,
  - cards translúcidos com bordas suaves.
- Ícones **Phosphor** em estilo _duotone_.
- Tipografia **Nunito** via `@expo-google-fonts/nunito`.
- Modais (`newEntry`, `stats`, detalhe da transação) com:
  - fundo escurecido,
  - animação de subida a partir da parte inferior da tela.

---

## 🧱 Stack técnica

- **React Native** (Expo)
- **Expo Router**
- **SQLite** com `expo-sqlite`
- **react-native-svg** + `expo-linear-gradient`
- **@expo-google-fonts/nunito**
- **phosphor-react-native**
- **react-native-safe-area-context**
- **react-native-keyboard-aware-scroll-view**
- **@react-native-community/datetimepicker**

---

## 🗄 Modelagem do banco

Tabela: `transactions`

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY NOT NULL,
  dateISO TEXT NOT NULL,       -- "YYYY-MM-DD"
  type TEXT NOT NULL,          -- 'income' | 'expense'
  amountCents INTEGER NOT NULL,
  title TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  notes TEXT,
  category TEXT,
  distanceMeters INTEGER       -- metros rodados (opcional)
);
```

Migrations controladas via PRAGMA user_version no initDB, evitando quebrar dados antigos.

## ▶️ Como rodar

```
git clone https://github.com/seu-usuario/mototrack.git
cd mototrack

# instalar dependências
npm install
# ou
yarn

# iniciar o projeto
npx expo start
# ou
yarn expo start
```

Depois é só abrir no Expo Go (dispositivo físico) ou emulador.
