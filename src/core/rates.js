/**
 * Veranlagungszeitraumbezogene Rechtsstandstabelle.
 *
 * Steuersaetze sind bewusst nicht in der Berechnungslogik hinterlegt, sondern
 * hier zentral je VZ abgelegt (Abschnitt 2.4 der Arbeit). Aenderungen des
 * Rechtsstands erfordern damit keinen Eingriff in den Berechnungskern.
 */

export const KONSTANTEN = {
  gewstMesszahl: 0.035,
  gewstFreibetragPersG: 24500,
  solzSatz: 0.055,
  abgeltungsteuerSatz: 0.25,
  nachversteuerungssatz34a: 0.25,
  anrechnungsfaktor35: 4.0,
};

/**
 * Tarifparameter des § 32a EStG. Der Tarif wird annahmegemaess ueber den
 * gesamten Betrachtungszeitraum konstant gehalten (Tabelle 2 der Arbeit);
 * massgeblich ist der hier gewaehlte Referenz-VZ.
 */
export const EST_TARIFE = {
  2025: {
    grundfreibetrag: 12096,
    zonen: [
      { bis: 12096, typ: 'null' },
      { bis: 17443, typ: 'progression', basis: 12096, a: 932.3, b: 1400, c: 0 },
      { bis: 68480, typ: 'progression', basis: 17443, a: 176.64, b: 2397, c: 1015.13 },
      { bis: 277825, typ: 'linear', satz: 0.42, abzug: 10911.92 },
      { bis: Infinity, typ: 'linear', satz: 0.45, abzug: 19246.03 },
    ],
    solzFreigrenze: 19950,
    solzMilderungssatz: 0.119,
  },
  2026: {
    grundfreibetrag: 12348,
    zonen: [
      { bis: 12348, typ: 'null' },
      { bis: 17799, typ: 'progression', basis: 12348, a: 914.51, b: 1400, c: 0 },
      { bis: 69878, typ: 'progression', basis: 17799, a: 173.1, b: 2397, c: 1034.87 },
      { bis: 277825, typ: 'linear', satz: 0.42, abzug: 11135.63 },
      { bis: Infinity, typ: 'linear', satz: 0.45, abzug: 19470.74 },
    ],
    solzFreigrenze: 20350,
    solzMilderungssatz: 0.119,
  },
};

export const REFERENZ_TARIF_VZ = 2026;

/**
 * Je VZ geltende Saetze. Die Absenkung des Koerperschaftsteuersatzes und des
 * Thesaurierungssteuersatzes folgt dem Gesetz fuer ein steuerliches
 * Investitionssofortprogramm vom 18.07.2025 (BGBl. 2025 I Nr. 161).
 */
const RECHTSSTAND = {
  2024: { kst: 0.15, thesaurierung34a: 0.2825, gewstMindesthebesatz: 200 },
  2025: { kst: 0.15, thesaurierung34a: 0.2825, gewstMindesthebesatz: 200 },
  2026: { kst: 0.15, thesaurierung34a: 0.2825, gewstMindesthebesatz: 200 },
  2027: { kst: 0.15, thesaurierung34a: 0.2825, gewstMindesthebesatz: 280 },
  2028: { kst: 0.14, thesaurierung34a: 0.27, gewstMindesthebesatz: 280 },
  2029: { kst: 0.13, thesaurierung34a: 0.27, gewstMindesthebesatz: 280 },
  2030: { kst: 0.12, thesaurierung34a: 0.26, gewstMindesthebesatz: 280 },
  2031: { kst: 0.11, thesaurierung34a: 0.26, gewstMindesthebesatz: 280 },
  2032: { kst: 0.1, thesaurierung34a: 0.25, gewstMindesthebesatz: 280 },
};

const LETZTER_GEREGELTER_VZ = 2032;

export function rechtsstand(vz) {
  if (RECHTSSTAND[vz]) return { vz, ...RECHTSSTAND[vz], fortgeschrieben: false };
  const quelle = vz > LETZTER_GEREGELTER_VZ ? LETZTER_GEREGELTER_VZ : 2024;
  return { vz, ...RECHTSSTAND[quelle], fortgeschrieben: true, quelleVz: quelle };
}

export function rechtsstandTabelle(vonVz, bisVz) {
  const zeilen = [];
  for (let vz = vonVz; vz <= bisVz; vz++) zeilen.push(rechtsstand(vz));
  return zeilen;
}
