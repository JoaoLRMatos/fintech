function getEaster(year: number): Date {
  const f = Math.floor;
  const a = year % 19;
  const b = f(year / 100);
  const c = year % 100;
  const d = f(b / 4);
  const e = b % 4;
  const g = f((8 * b + 13) / 25);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = f(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = f((a + 11 * h + 22 * l) / 451);
  const month = f((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function isHolidayOrWeekend(date: Date): boolean {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;

  const y = date.getFullYear();
  const m = date.getMonth(); // 0-11
  const d = date.getDate();

  // Fixed holidays in Brazil
  const fixed = [
    { m: 0, d: 1 },   // Confraternização Universal (Ano Novo)
    { m: 3, d: 21 },  // Tiradentes
    { m: 4, d: 1 },   // Dia do Trabalho
    { m: 8, d: 7 },   // Independência do Brasil
    { m: 9, d: 12 },  // Nossa Senhora Aparecida
    { m: 10, d: 2 },  // Finados
    { m: 10, d: 15 }, // Proclamação da República
    { m: 10, d: 20 }, // Dia da Consciência Negra
    { m: 11, d: 25 }, // Natal
  ];

  if (fixed.some(h => h.m === m && h.d === d)) return true;

  // Easter-based holidays
  const easter = getEaster(y);
  
  // Good Friday (Friday before Easter)
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  if (goodFriday.getMonth() === m && goodFriday.getDate() === d) return true;

  // Corpus Christi (Thursday, 60 days after Easter)
  const corpusChristi = new Date(easter);
  corpusChristi.setDate(easter.getDate() + 60);
  if (corpusChristi.getMonth() === m && corpusChristi.getDate() === d) return true;

  // Carnival Tuesday (Tuesday, 47 days before Easter)
  const carnival = new Date(easter);
  carnival.setDate(easter.getDate() - 47);
  if (carnival.getMonth() === m && carnival.getDate() === d) return true;

  return false;
}

/**
 * Soma `n` meses a uma data preservando o dia, mas LIMITANDO ao último dia do mês
 * de destino. Evita o overflow nativo do Date: 31/mai + 1 mês NÃO pode virar
 * 01/jul (junho não tem dia 31) — vira 30/jun. Sem isso, regras de fim de mês
 * (dia 30/31) pulam os meses mais curtos.
 */
export function addMonthsClamped(date: Date, n: number): Date {
  const day = date.getDate();
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

export function getFifthBusinessDayOfMonth(year: number, month: number): Date {
  let count = 0;
  let day = 1;
  while (count < 5 && day <= 31) {
    const d = new Date(year, month, day);
    if (!isHolidayOrWeekend(d)) {
      count++;
    }
    if (count === 5) {
      return d;
    }
    day++;
  }
  return new Date(year, month, 5); // fallback if anything goes wrong
}
