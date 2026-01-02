export function formatBRL(cents: number) {
  const value = Math.floor(Math.abs(cents)); // garante inteiro em centavos
  const inteiro = Math.floor(value / 100);
  const centavos = value % 100;

  const inteiroStr = inteiro.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); // adiciona pontos de milhar

  const centavosStr = centavos.toString().padStart(2, "0");

  return `${inteiroStr},${centavosStr}`;
}

// número em reais (float) → "12,34"
// (usado em R$/km, etc.)
export function formatBRLValue(v: number) {
  return v.toFixed(2).replace(".", ",");
}

// "2025-12-31" → "31"
export function formatDay(iso: string) {
  const parts = iso.split("-");
  return parts[2] ?? iso;
}

// (2025, 1) → "janeiro de 2025"
export function monthLabelPT(params: { year: number; month: number }) {
  const { year, month } = params;
  return new Date(year, month - 1, 1).toLocaleString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

// "2025-12-31" → "31/12/2025"
export function formatDateBR(iso: string) {
  // iso esperado: yyyy-mm-dd
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
