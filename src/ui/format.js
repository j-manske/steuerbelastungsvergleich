const eur0 = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const eur2 = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export const eur = (v) => eur0.format(v ?? 0);
export const eurExakt = (v) => eur2.format(v ?? 0);
export const zahl = (v) => num2.format(v ?? 0);
export const ganz = (v) => num0.format(v ?? 0);
export const prozent = (v, stellen = 2) =>
  `${new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  }).format((v ?? 0) * 100)} %`;

const kompakt = new Intl.NumberFormat('de-DE', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});
/** Kurzform fuer Diagrammachsen, z. B. "1,2 Mio. EUR". */
export const eurKompakt = (v) => `${kompakt.format(v ?? 0)} €`;

export function csvZahl(v) {
  return (v ?? 0).toFixed(2).replace('.', ',');
}
