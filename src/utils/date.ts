import { toISODate } from "./format";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Semana Seg–Dom.
 * - startISO = segunda-feira da semana do `anchor`
 * - endISO = domingo (padrão) OU "hoje" se clampEndToToday=true e anchor for semana atual
 */
export function getWeekRangeMonday(
  anchor: Date = new Date(),
  opts?: { clampEndToToday?: boolean },
) {
  const a = startOfDay(anchor);

  // JS: 0=Dom,1=Seg,...6=Sáb → queremos voltar até Segunda
  const day = a.getDay();
  const diffToMonday = (day + 6) % 7; // Dom->6, Seg->0, Ter->1, ...
  const start = addDays(a, -diffToMonday);
  const endSunday = addDays(start, 6);

  let end = endSunday;

  if (opts?.clampEndToToday) {
    const today = startOfDay(new Date());
    // só faz clamp se "today" estiver dentro desta mesma semana
    if (today >= start && today <= endSunday) {
      end = today;
    }
  }

  return {
    start,
    end,
    startISO: toISODate(start),
    endISO: toISODate(end),
  };
}

export function getMonthRange(year: number, month1to12: number) {
  const mm = String(month1to12).padStart(2, "0");
  const daysInMonth = new Date(year, month1to12, 0).getDate();
  return {
    startISO: `${year}-${mm}-01`,
    endISO: `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`,
  };
}
