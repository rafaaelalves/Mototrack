export type TransactionType = "income" | "expense";
export type TransactionCategory =
  | "fuel"
  | "food"
  | "maintenance"
  | "other"
  | null;

export type Transaction = {
  id: number;
  dateISO: string;
  type: TransactionType;
  amountCents: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  notes: string | null;
  category: string | null;
  distanceMeters: number | null;
};

export type MonthStats = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  fuelCents: number;
  foodCents: number;
  maintenanceCents: number;
  vehicleCents: number;
  otherCents: number;
  uncategorizedCents: number;
  km: number;
  netPerKm: number | null; //Lucro/Km
  costPerKm: number | null; //Custo/Km
};

export function computeMonthStats(transactions: Transaction[]): MonthStats {
  let incomeCents = 0;
  let expenseCents = 0;
  let fuelCents = 0;
  let foodCents = 0;
  let kmMeters = 0;
  let maintenanceCents = 0;
  let vehicleCents = 0;
  let otherCents = 0;
  let uncategorizedCents = 0;

  for (const t of transactions) {
    if (t.type === "income") {
      incomeCents += t.amountCents;

      if (typeof t.distanceMeters === "number" && t.distanceMeters > 0) {
        kmMeters += t.distanceMeters;
      }
    } else {
      expenseCents += t.amountCents;

      switch (t.category) {
        case "fuel":
          fuelCents += t.amountCents;
          break;
        case "food":
          foodCents += t.amountCents;
          break;
        case "maintenance":
          maintenanceCents += t.amountCents;
          break;
        case "vehicle":
          vehicleCents += t.amountCents;
          break;
        case "other":
          otherCents += t.amountCents;
          break;
        default:
          // null, undefined ou qualquer outra string inesperada
          uncategorizedCents += t.amountCents;
          break;
      }
    }
  }

  const netCents = incomeCents - expenseCents;
  const km = kmMeters / 1000;

  const netPerKm = km > 0 ? netCents / 100 / km : null;
  const costPerKm = km > 0 ? expenseCents / 100 / km : null;

  return {
    incomeCents,
    expenseCents,
    netCents,
    fuelCents,
    foodCents,
    maintenanceCents,
    vehicleCents,
    otherCents,
    uncategorizedCents,
    km,
    netPerKm,
    costPerKm,
  };
}
