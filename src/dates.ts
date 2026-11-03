// Day-precision date helpers. Everything works on local midnight dates.

export const pad = (n: number) => String(n).padStart(2, '0');

export const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole days from a to b, immune to DST shifts. */
export const diff = (a: Date, b: Date) =>
  Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5,
  );

export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
};

export const DOW = ['日', '一', '二', '三', '四', '五', '六'];

export const fmtDay = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）`;

export const fmtShort = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

/** wso: 0 = weeks start on Sunday, 1 = Monday. */
export const startOfWeek = (d: Date, wso: number) => addDays(dayOnly(d), -((d.getDay() - wso + 7) % 7));
