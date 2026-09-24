/**
 * Kontrollfaelle zur Absicherung des Berechnungskerns (Abschnitt 2.5 der Arbeit).
 *
 * Zwei Arten von Faellen:
 *   H(...)  sieben Faelle mit fest vorgegebenem, von Hand gerechnetem Sollwert.
 *           Der Rechenweg steht vollstaendig im Kommentar und ist ohne den Code
 *           nachvollziehbar.
 *   T(...)  Struktur- und Verhaltenspruefungen (Monotonie, Linearitaet, Grenzen
 *           des Anrechnungsvolumens nach § 35 EStG, Uebergang zum Mindesthebesatz).
 *
 * Das Pruefszenario ist bewusst nicht aus STANDARD_SZENARIO abgeleitet.
 */

import { berechne, STANDARD_SZENARIO } from '../src/core/model.js';
import { estTarif, gewerbesteuer, ermaessigung35, solzAufEst } from '../src/core/tarif.js';
import { rechtsstand } from '../src/core/rates.js';

const faelle = [];
const T = (name, fn) => faelle.push({ name, fn });
/** Kontrollfall mit fest vorgegebenem, von Hand gerechnetem Sollwert. */
const H = (name, fn) => faelle.push({ name, fn, handgerechnet: true });

function nah(ist, soll, toleranz = 0.01) {
  if (Math.abs(ist - soll) > toleranz) {
    throw new Error(`erwartet ${soll.toFixed(2)}, erhalten ${ist.toFixed(2)}`);
  }
}
function gleich(ist, soll) {
  if (ist !== soll) throw new Error(`erwartet ${soll}, erhalten ${ist}`);
}

/**
 * Pruefszenario. Bewusst vollstaendig ausgeschrieben und gerade NICHT aus
 * STANDARD_SZENARIO abgeleitet: ein Kontrollfall, dessen Sollwert sich aus den
 * Konstanten des Codes speist, kann eine Aenderung dieser Konstanten nicht
 * aufdecken. Aenderungen am Basisszenario duerfen die Kontrollfaelle nicht
 * stillschweigend verschieben.
 */
const PRUEF_OPTIONEN = {
  solzFreigrenze: true,
  mindesthebesatzErzwingen: true,
  est34aImHoechstbetrag: true,
  ausschuettungsfiktion1a: false,
  schlussausschuettung: true,
};

const basis = (ueberschreibungen = {}) => ({
  gewinn: 300000,
  verguetung: 0,
  thesaurierungsquote: 1,
  hebesatz: 400,
  kalkulationszins: 0,
  vonVz: 2026,
  bisVz: 2026,
  tarifVz: 2026,
  ...ueberschreibungen,
  optionen: { ...PRUEF_OPTIONEN, ...(ueberschreibungen.optionen ?? {}) },
});

/* ------------------------------------------------------------------ *
 * Von Hand gerechnete Sollwerte
 *
 * Diese sieben Faelle geben den Sollwert als feste Zahl vor. Die Rechnung ist
 * im Kommentar vollstaendig ausgeschrieben, sodass sie ohne den Code
 * nachvollzogen werden kann. Alle Faelle sind einperiodig (VZ 2026) und ohne
 * Diskontierung, damit die Arithmetik nachpruefbar bleibt.
 * ------------------------------------------------------------------ */

H('Sollwert 1 - § 32a EStG, obere Proportionalzone: zvE 300.000 EUR -> 115.529 EUR', () => {
  // 0,45 * 300.000 - 19.470,74 = 115.529,26; Abrundung auf volle EUR (§ 32a Abs. 1 S. 6)
  nah(estTarif(300000, 2026), 115529, 0.51);
});

H('Sollwert 2 - § 11 GewStG PersG: G 500.000 EUR, h 400 % -> 66.570 EUR', () => {
  // 500.000 abgerundet, ./. 24.500 Freibetrag = 475.500
  // 475.500 * 3,5 % = 16.642,50 Messbetrag; * 400 % = 66.570,00
  const g = gewerbesteuer(500000, 24500, 400);
  nah(g.messbetrag, 16642.5);
  nah(g.steuer, 66570);
});

H('Sollwert 3 - § 11 GewStG KapGes ohne Freibetrag: Ertrag 400.000 EUR, h 400 % -> 56.000 EUR', () => {
  // 400.000 * 3,5 % = 14.000 Messbetrag; * 400 % = 56.000,00
  const g = gewerbesteuer(400000, 0, 400);
  nah(g.messbetrag, 14000);
  nah(g.steuer, 56000);
});

H('Sollwert 4 - GmbH einperiodig, G 500.000 EUR, keine Vergütung, Thesaurierung -> 149.125 EUR', () => {
  // GewSt  = 500.000 * 3,5 % * 400 %          =  70.000,00
  // KSt    = 15 % * 500.000                   =  75.000,00
  // SolZ   = 5,5 % * 75.000                   =   4.125,00
  //                                            ------------
  //                                             149.125,00
  const p = berechne(
    basis({ gewinn: 500000, optionen: { schlussausschuettung: false } })
  ).varianten.gmbh.perioden[0];
  nah(p.komponenten.gewerbesteuer, 70000);
  nah(p.komponenten.koerperschaftsteuer, 75000);
  nah(p.komponenten.solz, 4125);
  nah(p.gesamt, 149125);
});

H('Sollwert 5 - PersG Regelbesteuerung einperiodig, G 500.000 EUR, h 400 % -> 213.171,75 EUR', () => {
  // GewSt        = 66.570,00 (Sollwert 2), Messbetrag 16.642,50
  // zvE          = 500.000,00 (GewSt nicht abziehbar, § 4 Abs. 5b EStG)
  // ESt tariflich= 0,45 * 500.000 - 19.470,74 = 205.529,26 -> 205.529
  // § 35 EStG    = min(4 * 16.642,50 ; gezahlte GewSt 66.570) = 66.570,00
  // ESt festges. = 205.529 - 66.570      = 138.959,00
  // SolZ         = 5,5 % * 138.959       =   7.642,745
  //                                       -------------
  // Gesamt       = 66.570 + 138.959 + 7.642,745 = 213.171,745
  const p = berechne({ ...basis({ gewinn: 500000 }) }).varianten.persG.perioden[0];
  nah(p.komponenten.gewerbesteuer, 66570);
  nah(p.komponenten.einkommensteuer, 138959);
  nah(p.komponenten.solz, 7642.745);
  nah(p.gesamt, 213171.745);
});

H('Sollwert 6 - PersG § 34a einperiodig, volle Thesaurierung, G 500.000 EUR -> 145.357,40 EUR', () => {
  // GewSt         = 66.570,00
  // beguenstigt B = 500.000 - 0 Vergütung - 0 Entnahme = 500.000,00
  // regelbesteuert=       0,00  ->  tarifliche ESt = 0,00
  // § 34a Abs. 1  = 28,25 % * 500.000          = 141.250,00
  // Hoechstbetrag = 0 + 141.250                = 141.250,00
  // § 35 EStG     = min(66.570 ; 66.570 ; 141.250) = 66.570,00
  // ESt festges.  = 141.250 - 66.570           =  74.680,00
  // SolZ          = 5,5 % * 74.680             =   4.107,40
  //                                             ------------
  // Gesamt        = 66.570 + 74.680 + 4.107,40 = 145.357,40
  const p = berechne(
    basis({ gewinn: 500000, optionen: { schlussausschuettung: false } })
  ).varianten.persG34a.perioden[0];
  nah(p.komponenten.gewerbesteuer, 66570);
  nah(p.gesamt, 145357.4);
});

H('Sollwert 7 - § 34a Abs. 4 EStG, Nachversteuerung in der Schlussperiode -> 237.928,70 EUR', () => {
  // Laufende Belastung wie Sollwert 6                    = 145.357,40
  // SolZ auf die Thesaurierungssteuer 5,5 % * 141.250    =   7.768,75
  // nvB-Zugang = 500.000 - 141.250 - 7.768,75            = 350.981,25
  // Nachsteuer = 25 % * 350.981,25                       =  87.745,3125
  // SolZ       = 5,5 % * 87.745,3125                     =   4.825,992
  //                                                       -------------
  // Gesamt = 145.357,40 + 87.745,3125 + 4.825,992        = 237.928,705
  const p = berechne({ ...basis({ gewinn: 500000 }) }).varianten.persG34a.perioden[0];
  const nv = p.posten.find((x) => x.label === 'Nachversteuerungsbetrag');
  nah(nv.betrag, 350981.25, 0.02);
  nah(p.gesamt, 237928.705, 0.02);
});

/* ---------------- Grundfunktionen ---------------- */

T('§ 32a EStG: Grundfreibetrag 2026 loest keine Steuer aus', () => {
  gleich(estTarif(12348), 0);
});

T('§ 32a EStG: Zonenuebergaenge sind stetig', () => {
  nah(estTarif(17799), estTarif(17800), 2);
  nah(estTarif(69878), estTarif(69879), 2);
  nah(estTarif(277825), estTarif(277826), 2);
});

T('§ 32a EStG: Spitzensteuersatz 45 % bei 300.000 EUR', () => {
  nah(estTarif(300000), Math.floor(0.45 * 300000 - 19470.74), 1);
});

T('§ 11 GewStG: Abrundung und Freibetrag', () => {
  const g = gewerbesteuer(300099, 24500, 400);
  gleich(g.abgerundet, 300000);
  nah(g.bemessungsgrundlage, 275500);
  nah(g.messbetrag, 9642.5);
  nah(g.steuer, 38570);
});

T('§ 11 GewStG: Kapitalgesellschaft ohne Freibetrag', () => {
  const g = gewerbesteuer(300000, 0, 400);
  nah(g.messbetrag, 10500);
  nah(g.steuer, 42000);
});

T('§ 35 EStG: bei 400 % deckt das Vierfache die Gewerbesteuer exakt', () => {
  const g = gewerbesteuer(300000, 24500, 400);
  const e = ermaessigung35(g.messbetrag, g.steuer, 999999);
  nah(e.anrechnung, g.steuer);
  nah(e.ueberhang, 0);
});

T('§ 35 EStG: oberhalb 400 % entsteht ein Anrechnungsüberhang', () => {
  const g = gewerbesteuer(300000, 24500, 500);
  const e = ermaessigung35(g.messbetrag, g.steuer, 999999);
  nah(e.anrechnung, 38570);
  nah(e.ueberhang, 0);
  // Die ueberschiessende Gewerbesteuer wird definitiv:
  nah(g.steuer - e.anrechnung, 9642.5);
});

T('§ 4 SolZG: Freigrenze greift unterhalb von 20.350 EUR', () => {
  gleich(solzAufEst(20000, { freigrenze: true }), 0);
  nah(solzAufEst(20000, { freigrenze: false }), 1100);
});

T('Rechtsstand: KSt und § 34a-Satz sinken periodengerecht', () => {
  nah(rechtsstand(2026).kst, 0.15);
  nah(rechtsstand(2028).kst, 0.14);
  nah(rechtsstand(2032).kst, 0.1);
  nah(rechtsstand(2026).thesaurierung34a, 0.2825);
  nah(rechtsstand(2028).thesaurierung34a, 0.27);
  nah(rechtsstand(2032).thesaurierung34a, 0.25);
  gleich(rechtsstand(2026).gewstMindesthebesatz, 200);
  gleich(rechtsstand(2027).gewstMindesthebesatz, 280);
});

/* ---------------- Personengesellschaft ---------------- */

T('PersG Regelbesteuerung bei 400 %: vollstaendige Anrechnung', () => {
  const e = berechne(basis());
  const p = e.varianten.persG.perioden[0];
  nah(p.komponenten.gewerbesteuer, 38570);
  nah(p.komponenten.einkommensteuer, 115529 - 38570);
  nah(p.komponenten.solz, 0.055 * (115529 - 38570));
  nah(p.gesamt, 38570 + 76959 + 4232.745);
});

T('PersG Regelbesteuerung: oberhalb 400 % steigt die Belastung genau um die Mehr-GewSt', () => {
  const a = berechne(basis({ hebesatz: 400 })).varianten.persG.perioden[0].gesamt;
  const b = berechne(basis({ hebesatz: 500 })).varianten.persG.perioden[0].gesamt;
  nah(b - a, 9642.5);
});

T('PersG Regelbesteuerung: unterhalb 400 % bleibt GewSt + ESt konstant', () => {
  const p300 = berechne(basis({ hebesatz: 300 })).varianten.persG.perioden[0];
  const p400 = berechne(basis({ hebesatz: 400 })).varianten.persG.perioden[0];
  nah(
    p300.komponenten.gewerbesteuer + p300.komponenten.einkommensteuer,
    p400.komponenten.gewerbesteuer + p400.komponenten.einkommensteuer
  );
});

T('PersG Regelbesteuerung: Entnahmequote ist ohne Einfluss', () => {
  const a = berechne(basis({ thesaurierungsquote: 1 })).varianten.persG.barwert;
  const b = berechne(basis({ thesaurierungsquote: 0 })).varianten.persG.barwert;
  nah(a, b);
});

/* ---------------- § 34a EStG ---------------- */

T('§ 34a EStG: voller Antrag beguenstigt den gesamten Gewinn (Rueckausnahme Abs. 2 S. 2)', () => {
  // Gegenauffassung: die Steuer auf den beguenstigten Gewinn bleibt beim
  // Ermaessigungshoechstbetrag des § 35 EStG au§er Ansatz, die Anrechnung
  // laeuft dann vollstaendig leer.
  const e = berechne(
    basis({ optionen: { schlussausschuettung: false, est34aImHoechstbetrag: false } })
  );
  const p = e.varianten.persG34a.perioden[0];
  const beguenstigt = p.posten.find((x) => x.label === 'begünstigungsfähiger Gewinn');
  nah(beguenstigt.betrag, 300000, 1);
  nah(p.komponenten.gewerbesteuer, 38570);
  // 28,25 % Thesaurierungssteuer, kein regelbesteuerter Anteil
  nah(p.gesamt, 38570 + 84750 + 0.055 * 84750);
});

T('§ 34a EStG: ohne Einbeziehung zehrt der Sondertarif den Höchstbetrag auf', () => {
  const e = berechne(
    basis({ optionen: { schlussausschuettung: false, est34aImHoechstbetrag: false } })
  );
  const p = e.varianten.persG34a.perioden[0];
  const ueberhang = p.posten.find((x) => x.label.startsWith('Anrechnungsüberhang'));
  nah(ueberhang.betrag, 4 * 9642.5, 1);
});

T('§ 34a EStG: Einbeziehung in den Hoechstbetrag ist Standard und erhaelt die Anrechnung', () => {
  // Auffassung der Finanzverwaltung, der die Arbeit folgt: Steuer auf den
  // beguenstigten Gewinn und Nachsteuer gehen in den Hoechstbetrag ein.
  gleich(STANDARD_SZENARIO.optionen.est34aImHoechstbetrag, true);
  const e = berechne(basis({ optionen: { schlussausschuettung: false } }));
  const p = e.varianten.persG34a.perioden[0];
  const ueberhang = p.posten.find((x) => x.label.startsWith('Anrechnungsüberhang'));
  nah(ueberhang.betrag, 0, 1);
});

T('§ 34a EStG: Thesaurierungsquote 0 fuehrt praktisch zur Regelbesteuerung', () => {
  const s = basis({ thesaurierungsquote: 0, optionen: { schlussausschuettung: false } });
  const regel = berechne(s).varianten.persG.perioden[0].gesamt;
  const mit34a = berechne(s).varianten.persG34a.perioden[0].gesamt;
  // Abweichung nur durch den Rueckausnahmebetrag in Hoehe der Gewerbesteuer.
  if (Math.abs(mit34a - regel) > 0.06 * regel) {
    throw new Error(`Abweichung zu gross: ${(mit34a - regel).toFixed(2)}`);
  }
});

T('§ 34a EStG: nachversteuerungspflichtiger Betrag wird fortgeschrieben', () => {
  const e = berechne(basis({ bisVz: 2028, optionen: { schlussausschuettung: false } }));
  const p = e.varianten.persG34a.perioden;
  const bestand = (i) =>
    p[i].posten.find((x) => x.label.startsWith('nachversteuerungspflichtiger Betrag')).betrag;
  nah(bestand(0), 300000 - 84750 - 0.055 * 84750, 1);
  if (!(bestand(1) > bestand(0) && bestand(2) > bestand(1))) {
    throw new Error('nvB waechst nicht monoton');
  }
});

T('§ 34a EStG: Schlussperiode versteuert den gesamten nvB nach', () => {
  const e = berechne(basis({ bisVz: 2028 }));
  const letzte = e.varianten.persG34a.perioden.at(-1);
  const bestand = letzte.posten.find((x) =>
    x.label.startsWith('nachversteuerungspflichtiger Betrag')
  );
  nah(bestand.betrag, 0, 0.5);
  const nv = letzte.posten.find((x) => x.label === 'Nachversteuerungsbetrag');
  if (nv.betrag <= 0) throw new Error('keine Nachversteuerung in der Schlussperiode');
});

/* ---------------- Kapitalgesellschaften ---------------- */

T('GmbH: laufende Belastung bei 400 % und voller Thesaurierung', () => {
  const e = berechne(basis({ optionen: { schlussausschuettung: false } }));
  const p = e.varianten.gmbh.perioden[0];
  nah(p.komponenten.gewerbesteuer, 42000);
  nah(p.komponenten.koerperschaftsteuer, 45000);
  nah(p.komponenten.solz, 2475);
  nah(p.gesamt, 89475);
});

T('GmbH: Gewerbesteuer wirkt linear ohne Knick', () => {
  const werte = [300, 400, 500, 600].map(
    (h) => berechne(basis({ hebesatz: h, optionen: { schlussausschuettung: false } })).varianten.gmbh.perioden[0].gesamt
  );
  const d1 = werte[1] - werte[0];
  const d2 = werte[2] - werte[1];
  const d3 = werte[3] - werte[2];
  nah(d1, d2, 0.5);
  nah(d2, d3, 0.5);
});

T('GmbH: Schlussperiode schuettet das thesaurierte Vermoegen vollstaendig aus', () => {
  const e = berechne(basis({ bisVz: 2028 }));
  const letzte = e.varianten.gmbh.perioden.at(-1);
  const bestand = letzte.posten.find((x) => x.label.startsWith('thesauriertes Vermögen'));
  nah(bestand.betrag, 0, 0.5);
  if (letzte.komponenten.abgeltungsteuer <= 0) throw new Error('keine Abgeltungsteuer');
});

T('GmbH: volle Ausschüttung ergibt die bekannte Gesamtbelastung von rund 48,3 %', () => {
  const e = berechne(basis({ thesaurierungsquote: 0, optionen: { solzFreigrenze: false } }));
  const v = e.varianten.gmbh;
  // GewSt 14 % + KSt 15 % zzgl. SolZ, danach 25 % AbgSt zzgl. SolZ
  nah(v.effektiv, 0.48331, 0.002);
});

T('Optierende Gesellschaft entspricht unter den Basisannahmen der GmbH', () => {
  const e = berechne(basis({ bisVz: 2032 }));
  nah(e.varianten.optierend.barwert, e.varianten.gmbh.barwert, 0.5);
});

T('Ausschüttungsfiktion § 1a Abs. 3 S. 5 KStG hebt den Stundungsvorteil auf', () => {
  const s = basis({ bisVz: 2032, kalkulationszins: 0.05 });
  const ohne = berechne(s);
  const mit = berechne({ ...s, optionen: { ...s.optionen, ausschuettungsfiktion1a: true } });
  // Nominal identisch, da in beiden Faellen der gesamte Gewinn ausgeschuettet wird.
  nah(mit.varianten.optierend.nominal, ohne.varianten.optierend.nominal, 1);
  // Im Barwert schlaegt die vorgezogene Ausschüttung als Nachteil durch.
  if (!(mit.varianten.optierend.barwert > ohne.varianten.optierend.barwert + 1)) {
    throw new Error('Fiktion fuehrt nicht zu hoeherem Barwert');
  }
});

/* ---------------- Mehrperiodigkeit ---------------- */

T('Mindesthebesatz wird ab EZ 2027 erzwungen', () => {
  const e = berechne(basis({ hebesatz: 200, bisVz: 2028 }));
  gleich(e.hebesaetze[0].hebesatz, 200);
  gleich(e.hebesaetze[1].hebesatz, 280);
  gleich(e.hebesaetze[2].hebesatz, 280);
  gleich(e.hebesaetze[1].angehoben, true);
});

T('Mindesthebesatz kann abgeschaltet werden', () => {
  const e = berechne(basis({ hebesatz: 200, bisVz: 2028, optionen: { mindesthebesatzErzwingen: false } }));
  gleich(e.hebesaetze[1].hebesatz, 200);
});

T('KSt-Absenkung senkt die Belastung der GmbH ab 2028', () => {
  const e = berechne(basis({ bisVz: 2032, optionen: { schlussausschuettung: false } }));
  const p = e.varianten.gmbh.perioden;
  nah(p[0].gesamt, p[1].gesamt); // 2026 = 2027
  if (!(p[2].gesamt < p[1].gesamt)) throw new Error('2028 nicht guenstiger als 2027');
  if (!(p[6].gesamt < p[5].gesamt)) throw new Error('2032 nicht guenstiger als 2031');
});

T('Diskontierung: bei i = 0 entspricht der Barwert der Nominalsumme', () => {
  const e = berechne(basis({ bisVz: 2032, kalkulationszins: 0 }));
  for (const key of ['persG', 'persG34a', 'gmbh', 'optierend']) {
    nah(e.varianten[key].barwert, e.varianten[key].nominal, 0.01);
  }
});

T('Diskontierung: positiver Zins erzeugt einen Stundungseffekt', () => {
  const e = berechne(basis({ bisVz: 2032, kalkulationszins: 0.05 }));
  for (const key of ['persG', 'gmbh']) {
    if (!(e.varianten[key].stundungseffekt > 0)) throw new Error(`kein Stundungseffekt bei ${key}`);
  }
});

T('Tätigkeitsvergütung mindert nur bei Kapitalgesellschaften die Bemessungsgrundlage', () => {
  const ohne = berechne(basis({ bisVz: 2032, verguetung: 0 }));
  const mit = berechne(basis({ bisVz: 2032, verguetung: 120000 }));
  // Personengesellschaft: Gewerbeertrag unveraendert
  nah(
    mit.varianten.persG.perioden[0].komponenten.gewerbesteuer,
    ohne.varianten.persG.perioden[0].komponenten.gewerbesteuer
  );
  // GmbH: Gewerbeertrag sinkt
  if (
    !(
      mit.varianten.gmbh.perioden[0].komponenten.gewerbesteuer <
      ohne.varianten.gmbh.perioden[0].komponenten.gewerbesteuer
    )
  ) {
    throw new Error('Verguetung mindert die GewSt der GmbH nicht');
  }
});

T('Rangfolge ist vollstaendig und eindeutig belegt', () => {
  const e = berechne(basis({ bisVz: 2032 }));
  gleich(e.rangfolge.length, 4);
  gleich(new Set(Object.values(e.varianten).map((v) => v.rang)).size, 4);
});

T('Gewinn 0 fuehrt zu Belastung 0', () => {
  const e = berechne(basis({ gewinn: 0, bisVz: 2032 }));
  for (const key of ['persG', 'persG34a', 'gmbh', 'optierend']) {
    nah(e.varianten[key].barwert, 0, 0.01);
  }
});

T('Gewerbesteuerfreibetrag entlastet die PersG im unteren Gewinnbereich', () => {
  const e = berechne(basis({ gewinn: 40000, bisVz: 2026 }));
  const persG = e.varianten.persG.perioden[0].komponenten.gewerbesteuer;
  const gmbh = e.varianten.gmbh.perioden[0].komponenten.gewerbesteuer;
  nah(persG, (40000 - 24500) * 0.035 * 4);
  nah(gmbh, 40000 * 0.035 * 4);
});

/* ---------------- Ausfuehrung ---------------- */

export function laufeTests() {
  const ergebnisse = faelle.map((f) => {
    try {
      f.fn();
      return { name: f.name, ok: true, handgerechnet: !!f.handgerechnet };
    } catch (fehler) {
      return { name: f.name, ok: false, handgerechnet: !!f.handgerechnet, fehler: fehler.message };
    }
  });
  return {
    ergebnisse,
    bestanden: ergebnisse.filter((r) => r.ok).length,
    gesamt: ergebnisse.length,
    handgerechnet: ergebnisse.filter((r) => r.handgerechnet).length,
  };
}
