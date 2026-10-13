/**
 * Kontrollfaelle zur Absicherung des Berechnungskerns (Abschnitt 2.5 der Arbeit).
 *
 * Zwei Arten von Faellen:
 *   H(...)  neun Faelle mit fest vorgegebenem, von Hand gerechnetem Sollwert.
 *           Der Rechenweg steht vollstaendig im Kommentar und ist ohne den Code
 *           nachvollziehbar.
 *   T(...)  Struktur- und Verhaltenspruefungen (Monotonie, Linearitaet, Grenzen
 *           des Anrechnungsvolumens nach § 35 EStG, Uebergang zum Mindesthebesatz).
 *
 * Das Pruefszenario ist bewusst nicht aus STANDARD_SZENARIO abgeleitet. Einzige
 * Ausnahme ist der Abschnitt "Veroeffentlichte Ergebnisse der Arbeit" am Ende:
 * dort ist gerade zu pruefen, dass die Voreinstellung des Tools das
 * Basisszenario abbildet und die abgedruckten Zahlen reproduziert.
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
  teileinkuenfte: false,
  guenstigerpruefung: false,
  schlussausschuettung: true,
};

const basis = (ueberschreibungen = {}) => ({
  gewinn: 300000,
  verguetung: 0,
  weitereEinkuenfte: 0,
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
 * Diese neun Faelle geben den Sollwert als feste Zahl vor. Die Rechnung ist
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

H('Sollwert 8 - Teileinkünfteverfahren, GmbH einperiodig, G 300.000 EUR -> 133.696,38 EUR', () => {
  // Gesellschaftsebene (keine Vergütung, h 400 %):
  //   GewSt  = 300.000 * 3,5 % * 400 %                       =  42.000,00
  //   KSt    = 15 % * 300.000                                =  45.000,00
  //   SolZ   = 5,5 % * 45.000                                =   2.475,00
  //   JUe    = 300.000 - 42.000 - 45.000 - 2.475             = 210.525,00
  // Schlussperiode: vollstaendige Ausschuettung von 210.525,00
  //
  // Gesellschafterebene mit § 32d Abs. 2 Nr. 3 EStG:
  //   steuerpflichtig 60 %   = 0,6 * 210.525                 = 126.315,00
  //   (40 % = 84.210,00 steuerfrei, § 3 Nr. 40 Buchst. d EStG)
  //   zvE = 126.315 liegt in der oberen Proportionalzone ab 69.879:
  //   ESt = 0,42 * 126.315 - 11.135,63 = 41.916,67 -> 41.916  (§ 32a Abs. 1 S. 6)
  //   SolZ: 41.916 > Freigrenze 20.350, Milderungszone
  //         min( 5,5 % * 41.916 ; 11,9 % * (41.916 - 20.350) )
  //       = min( 2.305,38 ; 2.566,354 )                      =   2.305,38
  //                                                           ------------
  //   Gesamt = 42.000 + 45.000 + 2.475 + 41.916 + 2.305,38   = 133.696,38
  const p = berechne(basis({ optionen: { teileinkuenfte: true } })).varianten.gmbh.perioden[0];
  const frei = p.posten.find((x) => x.label === './. steuerfreier Teil (40 %)');
  nah(frei.betrag, -84210);
  nah(p.komponenten.einkommensteuer, 41916);
  nah(p.komponenten.abgeltungsteuer, 0);
  nah(p.gesamt, 133696.38);
});

H('Sollwert 9 - Sockelbetrag, PersG Regel, G 500.000 EUR, W 100.000 EUR -> 228.531,58 EUR', () => {
  // Weitere Einkuenfte wirken als Sockel: sie heben den Grenzsteuersatz, die auf
  // sie selbst entfallende Steuer wird aber herausgerechnet. Ausgewiesen ist
  //   ESt(W + G) - ESt(W)  bzw.  SolZ(W + G) - SolZ(W).
  //
  // GewSt wie Sollwert 2                                   =  66.570,00
  //   Messbetrag                                           =  16.642,50
  //
  // ESt(W)     = 0,42 * 100.000 - 11.135,63 = 30.864,37 ->  30.864
  // ESt(W + G) = 0,45 * 600.000 - 19.470,74 = 250.529,26 -> 250.529
  // tarifliche ESt des Gewinns = 250.529 - 30.864         = 219.665,00
  //
  // § 35 Abs. 1 S. 2 EStG: Hoechstbetrag nur anteilig
  //   Anteil = 500.000 / 600.000 = 83,33 %
  //   Hoechstbetrag = 250.529 * 5/6                       = 208.774,17
  //   Anrechnung = min(4 * 16.642,50 ; 66.570 ; 208.774,17) = 66.570,00
  //
  // ESt festgesetzt (gesamt) = 250.529 - 66.570           = 183.959,00
  //   davon Sockel                                         =  30.864,00
  //   ausgewiesen                                          = 153.095,00
  // SolZ (gesamt) = min(5,5 % * 183.959 ; 11,9 % * 163.609)
  //               = min(10.117,745 ; 19.469,471)          =  10.117,745
  // SolZ (Sockel) = min(5,5 % * 30.864 ; 11,9 % * 10.514)
  //               = min(1.697,52 ; 1.251,166)             =   1.251,166
  //   ausgewiesen                                          =   8.866,579
  //                                                         -------------
  // Gesamt = 66.570 + 153.095 + 8.866,579                 = 228.531,579
  const p = berechne(
    basis({ gewinn: 500000, weitereEinkuenfte: 100000 })
  ).varianten.persG.perioden[0];
  nah(p.komponenten.gewerbesteuer, 66570);
  nah(p.posten.find((x) => x.label === 'weitere Einkünfte (Sockel)').betrag, 100000);
  nah(p.posten.find((x) => x.label === 'zu versteuerndes Einkommen').betrag, 600000);
  nah(p.posten.find((x) => x.label === 'tarifliche Einkommensteuer').betrag, 219665);
  nah(p.posten.find((x) => x.label === 'Ermäßigungshöchstbetrag').betrag, 208774.1667);
  nah(p.komponenten.einkommensteuer, 153095);
  nah(p.komponenten.solz, 8866.579);
  nah(p.gesamt, 228531.579);
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

T('§ 35 Abs. 1 S. 5 EStG: oberhalb 400 % bleibt Gewerbesteuer endgültig', () => {
  const g = gewerbesteuer(300000, 24500, 500);
  const e = ermaessigung35(g.messbetrag, g.steuer, 999999);
  nah(e.anrechnung, 38570);
  // Das Anrechnungsvolumen ist voll ausgeschoepft, es verfaellt nichts davon.
  nah(e.ueberhang, 0);
  // Die ueberschiessende Gewerbesteuer wird definitiv - das ist die Groesse,
  // die den Hebesatzeffekt oberhalb von 400 % allein traegt.
  nah(e.nichtAngerechneteGewSt, 9642.5);
  nah(g.steuer - e.anrechnung, 9642.5);
});

T('§ 35 EStG: die hebesatzabhaengigen Begrenzungen trennen sich bei 400 %', () => {
  // Nur die beiden hebesatzabhaengigen Ursachen schliessen einander aus:
  // unterhalb von 400 % verfaellt Anrechnungsvolumen mangels Gewerbesteuer
  // (S. 5), oberhalb bleibt Gewerbesteuer ueber 4 x Messbetrag endgueltig.
  // Ein bindender Ermaessigungshoechstbetrag ist davon unabhaengig und hier
  // durch einen sehr hohen Wert ausgeschaltet.
  for (const h of [200, 280, 350, 399, 400, 401, 450, 600]) {
    const g = gewerbesteuer(300000, 24500, h);
    const e = ermaessigung35(g.messbetrag, g.steuer, 999999);
    gleich(e.durchHoechstbetrag < 0.01, true);
    if (e.ohneGewSt > 0.01 && e.ueberVolumen > 0.01) {
      throw new Error(`bei h = ${h} % treten beide Hebesatzursachen zugleich auf`);
    }
    if (h < 400 && e.ueberVolumen > 0.01) {
      throw new Error(`bei h = ${h} % darf keine Gewerbesteuer endgueltig bleiben`);
    }
    if (h > 400 && e.ohneGewSt > 0.01) {
      throw new Error(`bei h = ${h} % darf kein Anrechnungsvolumen mangels GewSt verfallen`);
    }
  }
});

T('§ 35 EStG: die drei Ursachen zerlegen Volumen und Gewerbesteuer vollstaendig', () => {
  // Es gelten zwei Identitaeten, und zwar fuer jede Konstellation:
  //   ungenutztes Volumen        = ohneGewSt      + durchHoechstbetrag
  //   nicht angerechnete GewSt   = ueberVolumen   + durchHoechstbetrag
  // Beide teilen den Summanden durchHoechstbetrag und sind deshalb NICHT
  // disjunkt; sie duerfen nicht addiert werden.
  for (const h of [200, 280, 350, 400, 450, 600]) {
    for (const hoechst of [0, 1000, 20000, 38570, 999999]) {
      const g = gewerbesteuer(300000, 24500, h);
      const e = ermaessigung35(g.messbetrag, g.steuer, hoechst);
      nah(e.ueberhang, e.anrechnungsvolumen - e.anrechnung);
      nah(e.ueberhang, e.ohneGewSt + e.durchHoechstbetrag);
      nah(e.nichtAngerechneteGewSt, g.steuer - e.anrechnung);
      nah(e.nichtAngerechneteGewSt, e.ueberVolumen + e.durchHoechstbetrag);
      // Die Anrechnung ist nie groesser als eine der drei Grenzen.
      gleich(e.anrechnung <= e.anrechnungsvolumen + 1e-6, true);
      gleich(e.anrechnung <= g.steuer + 1e-6, true);
      gleich(e.anrechnung <= hoechst + 1e-6, true);
    }
  }
});

H('Sollwert 12 - § 35 EStG, Hoechstbetrag und Hebesatzgrenze binden zugleich', () => {
  // Messbetrag 10.000 -> Volumen 40.000; gezahlte
  // Gewerbesteuer 30.000 (entspricht einem Hebesatz von 300 %), davon
  // anrechenbar nur 12.000 wegen des Hoechstbetrags.
  //   ohneGewSt          = 40.000 - 30.000 = 10.000
  //   durchHoechstbetrag = 30.000 - 12.000 = 18.000
  //   ueberVolumen       = 0
  //   ungenutztes Volumen      = 10.000 + 18.000 = 28.000
  //   nicht angerechnete GewSt =      0 + 18.000 = 18.000
  const e = ermaessigung35(10000, 30000, 12000);
  nah(e.anrechnung, 12000);
  nah(e.ohneGewSt, 10000);
  nah(e.durchHoechstbetrag, 18000);
  nah(e.ueberVolumen, 0);
  nah(e.ueberhang, 28000);
  nah(e.nichtAngerechneteGewSt, 18000);
  // Hier tritt der Fall auf, den der frueher behauptete Ausschluss verneinte.
  gleich(e.ursachen.length, 2);
});

T('§ 35 EStG: Ursache der Begrenzung wird richtig benannt', () => {
  // Der fruehere Text behauptete unterhalb von 400 % einen "Hebesatz > 400 %".
  const unten = gewerbesteuer(300000, 24500, 300);
  const eUnten = ermaessigung35(unten.messbetrag, unten.steuer, 999999);
  if (!/unter 400 %/.test(eUnten.ueberhangUrsache ?? '')) {
    throw new Error(`unerwartete Ursache unterhalb 400 %: ${eUnten.ueberhangUrsache}`);
  }
  if (/über 400 %/.test(eUnten.ueberhangUrsache ?? '')) {
    throw new Error(`unterhalb 400 % darf kein "über 400 %" behauptet werden: ${eUnten.ueberhangUrsache}`);
  }
  // Greift der Hoechstbetrag, muss § 35 Abs. 1 S. 2 EStG genannt werden.
  const oben = gewerbesteuer(300000, 24500, 400);
  const eOben = ermaessigung35(oben.messbetrag, oben.steuer, 1000);
  if (!/S\. 2 EStG/.test(eOben.ueberhangUrsache ?? '')) {
    throw new Error(`unerwartete Ursache beim Hoechstbetrag: ${eOben.ueberhangUrsache}`);
  }
  // Binden beide, muessen beide genannt werden.
  const beide = ermaessigung35(10000, 30000, 12000);
  for (const muster of [/S\. 5 EStG/, /S\. 2 EStG/]) {
    if (!muster.test(beide.ueberhangUrsache ?? '')) {
      throw new Error(`Ursache unvollstaendig: ${beide.ueberhangUrsache}`);
    }
  }
  // Ohne jede Begrenzung bleibt die Ursache leer.
  const glatt = ermaessigung35(10000, 40000, 999999);
  gleich(glatt.ueberhangUrsache, null);
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
  const ueberhang = p.posten.find((x) => x.label.includes('ungenutztes Anrechnungsvolumen'));
  nah(ueberhang.betrag, 4 * 9642.5, 1);
});

H('Sollwert 13 - § 34a Abs. 4 EStG: die Nachsteuer geht in den Hoechstbetrag ein', () => {
  // BMF vom 03.11.2016, BStBl I 2016, 1187, Rn. 15: im Veranlagungszeitraum der
  // Nachversteuerung gehoert "die Einkommensteuer auf den Nachversteuerungs-
  // betrag zur tariflichen Einkommensteuer", die Nachversteuerungsbetraege
  // selbst aber NICHT zu den beguenstigten gewerblichen Einkuenften. Die
  // Nachsteuer erhoeht daher den Multiplikator des § 35 Abs. 1 S. 2 EStG, nicht
  // den Quotienten.
  //
  // Konstellation: G 300.000, h 300 %, volle Thesaurierung, Schlussausschuettung
  // in derselben (einzigen) Periode, kein Sockel. Dann ist der regelbesteuerte
  // Gewinnanteil 0 und die tarifliche ESt darauf ebenfalls 0, sodass sich der
  // Hoechstbetrag allein aus den § 34a-Bestandteilen speist.
  //
  //   Messbetrag       = (300.000 - 24.500) * 3,5 %      =  9.642,50
  //   GewSt            = 9.642,50 * 300 %                = 28.927,50
  //   B                = 300.000 (volle Thesaurierung)
  //   ESt § 34a Abs. 1 = 28,25 % * 300.000               = 84.750,00
  //   SolZ darauf      = 5,5 % * 84.750                  =  4.661,25
  //   nvB-Zugang       = 300.000 - 84.750 - 4.661,25     = 210.588,75
  //   Nachsteuer       = 25 % * 210.588,75               = 52.647,1875
  //   Quotient         = 300.000 / 300.000               = 1
  //   Hoechstbetrag    = 0 + 84.750 + 52.647,1875        = 137.397,1875
  //   Volumen 4 x M    = 4 * 9.642,50                    = 38.570,00
  //   Anrechnung       = min(38.570 ; 28.927,50 ; 137.397,1875) = 28.927,50
  const s = basis({
    gewinn: 300000,
    hebesatz: 300,
    thesaurierungsquote: 1,
    optionen: { schlussausschuettung: true },
  });
  const p = berechne(s).varianten.persG34a.perioden[0];
  const holen = (l) => p.posten.find((x) => x.label.startsWith(l)).betrag;
  // Die Nachsteuer muss ueberhaupt anfallen, sonst prueft der Fall nichts.
  nah(holen('Nachversteuerungsbetrag'), 210588.75, 0.02);
  nah(holen('Ermäßigungshöchstbetrag'), 137397.1875, 0.02);
  nah(holen('./. Steuerermäßigung'), -28927.5, 0.02);
  // Die Gewerbesteuer ist damit vollstaendig angerechnet.
  nah(holen('nicht angerechnete Gewerbesteuer'), 0, 0.02);
});

T('§ 34a Abs. 4 EStG: ohne Einbeziehung entfaellt die Nachsteuer aus dem Hoechstbetrag', () => {
  // Gegenauffassung: die Option entfernt beide § 34a-Bestandteile gemeinsam.
  // Derselbe Fall wie vorstehend, nur mit abgeschalteter Option. Der
  // regelbesteuerte Anteil ist 0, also ist der Hoechstbetrag 0 und die gesamte
  // Gewerbesteuer bleibt endgueltig.
  const s = basis({
    gewinn: 300000,
    hebesatz: 300,
    thesaurierungsquote: 1,
    optionen: { est34aImHoechstbetrag: false, schlussausschuettung: true },
  });
  const p = berechne(s).varianten.persG34a.perioden[0];
  const holen = (l) => p.posten.find((x) => x.label.startsWith(l)).betrag;
  nah(holen('Nachversteuerungsbetrag'), 210588.75, 0.02);
  nah(holen('Ermäßigungshöchstbetrag'), 0, 0.01);
  nah(holen('./. Steuerermäßigung'), 0, 0.01);
  nah(holen('nicht angerechnete Gewerbesteuer'), 28927.5, 0.02);
});

T('§ 35 Abs. 1 S. 2 EStG: der Nachversteuerungsbetrag erhoeht den Quotienten nicht', () => {
  // Kehrseite der Asymmetrie aus BMF Rn. 15. Mit einem Sockel weiterer
  // Einkuenfte ist der Quotient gewerbliche / alle Einkuenfte kleiner als 1.
  // Waere der Nachversteuerungsbetrag als gewerbliche Einkunft mitgezaehlt,
  // wuerde der Quotient steigen. Er muss unveraendert G / (G + W) betragen.
  const W = 200000;
  const s = basis({
    gewinn: 300000,
    hebesatz: 300,
    thesaurierungsquote: 1,
    weitereEinkuenfte: W,
    optionen: { schlussausschuettung: true },
  });
  const p = berechne(s).varianten.persG34a.perioden[0];
  const holen = (l) => p.posten.find((x) => x.label.startsWith(l)).betrag;
  const nv = holen('Nachversteuerungsbetrag');
  if (!(nv > 100000)) {
    throw new Error(`Nachsteuer zu klein, Fall prueft nichts: ${nv.toFixed(2)}`);
  }
  // Quotient aus dem ausgewiesenen Hoechstbetrag zurueckgerechnet.
  const hb = holen('Ermäßigungshöchstbetrag');
  const basisSteuer = estTarif(W + 0, 2026) + 0.2825 * 300000 + 0.25 * nv;
  nah(hb, basisSteuer * (300000 / (300000 + W)), 1);
});

T('§ 34a EStG: Einbeziehung in den Hoechstbetrag ist Standard und erhaelt die Anrechnung', () => {
  // Auffassung der Finanzverwaltung, der die Arbeit folgt: die Steuer auf den
  // beguenstigten Gewinn nach § 34a Abs. 1 EStG geht in den Hoechstbetrag ein.
  // Die Nachsteuer des Abs. 4 dagegen nicht - siehe vorstehenden Fall.
  gleich(STANDARD_SZENARIO.optionen.est34aImHoechstbetrag, true);
  const e = berechne(basis({ optionen: { schlussausschuettung: false } }));
  const p = e.varianten.persG34a.perioden[0];
  const ueberhang = p.posten.find((x) => x.label.includes('ungenutztes Anrechnungsvolumen'));
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

/* ---------------- Wahlrechte des § 32d EStG ---------------- */

T('Ausschüttungsbesteuerung: Grundfall ist der gesonderte Tarif', () => {
  // Tabelle 2 der Arbeit: weder Teileinkuenfteverfahren noch Guenstigerpruefung.
  gleich(STANDARD_SZENARIO.optionen.teileinkuenfte, false);
  gleich(STANDARD_SZENARIO.optionen.guenstigerpruefung, false);
  const p = berechne(basis()).varianten.gmbh.perioden[0];
  if (!(p.komponenten.abgeltungsteuer > 0)) throw new Error('keine Abgeltungsteuer im Grundfall');
});

T('§ 32d Abs. 2 Nr. 3 EStG: 40 % der Ausschüttung bleiben steuerfrei', () => {
  const p = berechne(basis({ optionen: { teileinkuenfte: true } })).varianten.gmbh.perioden[0];
  const a = p.posten.find((x) => x.label === 'Ausschüttung').betrag;
  const frei = -p.posten.find((x) => x.label === './. steuerfreier Teil (40 %)').betrag;
  const zvE = p.posten.find((x) => x.label === 'zu versteuerndes Einkommen').betrag;
  nah(frei, 0.4 * a, 0.02);
  nah(zvE, 0.6 * a, 0.02);
  // Der gesonderte Tarif ist ausgeschlossen (§ 32d Abs. 2 Nr. 3 S. 1 EStG).
  nah(p.komponenten.abgeltungsteuer, 0);
});

T('Teileinkünfteverfahren ist im Spitzensteuersatz nachteilig', () => {
  // 60 % * 42 % = 25,2 % > 25 %. Bei einem Gehalt von 150.000 EUR liegt bereits
  // der erste Euro der Ausschuettung in der oberen Proportionalzone.
  const s = basis({ gewinn: 600000, verguetung: 150000 });
  const ohne = berechne(s).varianten.gmbh.barwert;
  const mit = berechne({ ...s, optionen: { ...s.optionen, teileinkuenfte: true } }).varianten.gmbh
    .barwert;
  if (!(mit > ohne + 1)) throw new Error('TEV muesste im Spitzensteuersatz teurer sein');
});

T('Teileinkünfteverfahren ist bei niedrigem Grenzsteuersatz vorteilhaft', () => {
  const s = basis({ gewinn: 60000 });
  const ohne = berechne(s).varianten.gmbh.barwert;
  const mit = berechne({ ...s, optionen: { ...s.optionen, teileinkuenfte: true } }).varianten.gmbh
    .barwert;
  if (!(mit < ohne - 1)) throw new Error('TEV muesste bei niedrigem Tarif guenstiger sein');
});

T('§ 32d Abs. 6 EStG: Günstigerprüfung erhöht die Belastung nie', () => {
  // Kernaussage der Norm: die Veranlagung tritt nur ein, wenn sie guenstiger ist.
  for (const gewinn of [20000, 40000, 60000, 80000, 120000, 200000, 400000, 800000]) {
    const s = basis({ gewinn });
    const ohne = berechne(s).varianten.gmbh.barwert;
    const mit = berechne({ ...s, optionen: { ...s.optionen, guenstigerpruefung: true } }).varianten
      .gmbh.barwert;
    if (mit > ohne + 0.01) {
      throw new Error(`Guenstigerpruefung verteuert bei Gewinn ${gewinn}`);
    }
  }
});

T('Günstigerprüfung bleibt bei hohem zvE ohne Wirkung', () => {
  const s = basis({ gewinn: 600000, verguetung: 150000 });
  const ohne = berechne(s).varianten.gmbh;
  const mit = berechne({ ...s, optionen: { ...s.optionen, guenstigerpruefung: true } }).varianten
    .gmbh;
  nah(mit.barwert, ohne.barwert, 0.01);
  // Es bleibt beim gesonderten Tarif, die Abgeltungsteuer wird weiter ausgewiesen.
  if (!(mit.perioden[0].komponenten.abgeltungsteuer > 0)) {
    throw new Error('Abgeltungsteuer haette bestehen bleiben muessen');
  }
});

T('Günstigerprüfung greift bei kleinem Gewinn', () => {
  const s = basis({ gewinn: 50000 });
  const ohne = berechne(s).varianten.gmbh;
  const mit = berechne({ ...s, optionen: { ...s.optionen, guenstigerpruefung: true } }).varianten
    .gmbh;
  if (!(mit.barwert < ohne.barwert - 1)) throw new Error('Guenstigerpruefung ohne Wirkung');
  nah(mit.perioden[0].komponenten.abgeltungsteuer, 0);
});

T('Teileinkünfteverfahren verdrängt die Günstigerprüfung', () => {
  // § 32d Abs. 6 EStG erfasst nur Ertraege, die dem Abs. 1 unterliegen.
  const s = basis({ gewinn: 50000 });
  const nurTev = berechne({ ...s, optionen: { ...s.optionen, teileinkuenfte: true } }).varianten.gmbh
    .barwert;
  const beide = berechne({
    ...s,
    optionen: { ...s.optionen, teileinkuenfte: true, guenstigerpruefung: true },
  }).varianten.gmbh.barwert;
  nah(beide, nurTev, 0.01);
});

T('Die Wahlrechte des § 32d EStG lassen die Personengesellschaft unberührt', () => {
  // Entnahmen sind keine Kapitalertraege; die Nachversteuerung nach § 34a Abs. 4
  // EStG folgt einem eigenen Sondertarif.
  const s = basis({ gewinn: 400000, thesaurierungsquote: 0.5, bisVz: 2030 });
  const ohne = berechne(s);
  const mit = berechne({
    ...s,
    optionen: { ...s.optionen, teileinkuenfte: true, guenstigerpruefung: true },
  });
  nah(mit.varianten.persG.barwert, ohne.varianten.persG.barwert, 0.01);
  nah(mit.varianten.persG34a.barwert, ohne.varianten.persG34a.barwert, 0.01);
});

/* ---------------- Weitere Einkuenfte (Sockelbetrag) ---------------- */

T('Sockel 0 laesst jeden Wert unveraendert', () => {
  // Regressionsschutz: die veroeffentlichten Werte der Arbeit duerfen sich
  // durch die Einfuehrung des Sockels nicht verschoben haben.
  for (const g of [50000, 150000, 500000]) {
    for (const h of [280, 400, 600]) {
      const ohne = berechne(basis({ gewinn: g, hebesatz: h, bisVz: 2030, thesaurierungsquote: 0.5 }));
      const mit = berechne(
        basis({ gewinn: g, hebesatz: h, bisVz: 2030, thesaurierungsquote: 0.5, weitereEinkuenfte: 0 })
      );
      for (const k of ['persG', 'persG34a', 'gmbh', 'optierend']) {
        gleich(mit.varianten[k].barwert, ohne.varianten[k].barwert);
      }
    }
  }
});

T('Sockel erhoeht die Belastung, aber nie mehr als der Tarif zulaesst', () => {
  let vorher = null;
  for (const W of [0, 20000, 50000, 100000, 300000, 1000000]) {
    const e = berechne(basis({ gewinn: 200000, weitereEinkuenfte: W }));
    const b = e.varianten.persG.barwert;
    if (vorher !== null && b < vorher - 0.01) {
      throw new Error(`Belastung faellt bei W = ${W}: ${b.toFixed(2)} < ${vorher.toFixed(2)}`);
    }
    vorher = b;
  }
  // Obergrenze: bei beliebig hohem Sockel greift durchgaengig der Spitzensteuersatz.
  const grenze = berechne(basis({ gewinn: 200000, weitereEinkuenfte: 5000000 }));
  const p = grenze.varianten.persG.perioden[0];
  nah(p.posten.find((x) => x.label === 'tarifliche Einkommensteuer').betrag, 0.45 * 200000, 1.01);
});

T('Sockel fuehrt in keiner Ausprägung zu negativer zugerechneter Steuer', () => {
  for (const W of [0, 5000, 12348, 30000, 100000, 500000]) {
    for (const g of [30000, 60000, 150000, 500000]) {
      for (const h of [200, 400, 600]) {
        const e = berechne(
          basis({ weitereEinkuenfte: W, gewinn: g, verguetung: Math.min(100000, g), hebesatz: h })
        );
        for (const k of ['persG', 'persG34a', 'gmbh', 'optierend']) {
          for (const p of e.varianten[k].perioden) {
            if (p.komponenten.einkommensteuer < -0.01 || p.komponenten.solz < -0.01 || p.gesamt < -0.01) {
              throw new Error(`negativ bei W=${W} G=${g} h=${h} ${k}`);
            }
          }
        }
      }
    }
  }
});

T('§ 35 Abs. 1 S. 2 EStG: Quotient ist 1 ohne weitere Einkuenfte', () => {
  const p = berechne(basis({ gewinn: 500000 })).varianten.persG.perioden[0];
  const hb = p.posten.find((x) => x.label === 'Ermäßigungshöchstbetrag').betrag;
  const est = p.posten.find((x) => x.label === 'tarifliche Einkommensteuer').betrag;
  nah(hb, est, 0.01);
});

T('§ 35 Abs. 1 S. 2 EStG: Hoechstbetrag wird anteilig gekuerzt', () => {
  // Der Hoechstbetrag muss dem Anteil der gewerblichen Einkuenfte an der Summe
  // der Einkuenfte entsprechen und darf die auf den Gewinn entfallende Steuer
  // nie uebersteigen (sonst entstuende eine Anrechnung zulasten des Sockels).
  for (const W of [10000, 50000, 200000]) {
    for (const g of [40000, 150000, 500000]) {
      const p = berechne(basis({ gewinn: g, weitereEinkuenfte: W })).varianten.persG.perioden[0];
      const hb = p.posten.find((x) => x.label === 'Ermäßigungshöchstbetrag').betrag;
      const estTariflich = p.posten.find((x) => x.label === 'tarifliche Einkommensteuer').betrag;
      const estGesamt = estTarif(W + g, 2026);
      nah(hb, (estGesamt * g) / (g + W), 0.02);
      if (hb > estTariflich + 0.01) {
        throw new Error(`Hoechstbetrag ${hb.toFixed(2)} > zugerechnete ESt ${estTariflich.toFixed(2)}`);
      }
    }
  }
});

T('Sockel belastet die Personengesellschaft staerker als die GmbH', () => {
  // Der Sockel hebt den Grenzsteuersatz. Bei der Personengesellschaft schlaegt
  // das auf den gesamten Gewinn durch, bei der GmbH nur auf die Vergütung -
  // die Ausschuettung bleibt beim gesonderten Tarif von 25 %.
  const b = (W) => berechne(basis({ gewinn: 300000, verguetung: 60000, weitereEinkuenfte: W }));
  const ohne = b(0);
  const mit = b(150000);
  const dPersG = mit.varianten.persG.barwert - ohne.varianten.persG.barwert;
  const dGmbH = mit.varianten.gmbh.barwert - ohne.varianten.gmbh.barwert;
  if (!(dPersG > dGmbH)) {
    throw new Error(`PersG ${dPersG.toFixed(2)} nicht groesser als GmbH ${dGmbH.toFixed(2)}`);
  }
});

T('Sockel laesst den Sondertarif des § 34a EStG unberuehrt', () => {
  // § 34a Abs. 1 EStG ist ein fester Satz von 28,25 %; weitere Einkuenfte
  // duerfen ihn nicht veraendern.
  const soll = 0.2825 * 300000;
  for (const W of [0, 100000, 400000]) {
    const p = berechne(
      basis({ gewinn: 300000, weitereEinkuenfte: W, optionen: { schlussausschuettung: false } })
    ).varianten.persG34a.perioden[0];
    const st = p.posten.find((x) => /34a Abs. 1|Sondertarif|Thesaurierungssteuer/i.test(x.label + x.norm));
    if (!st) throw new Error('Posten des Sondertarifs nicht gefunden');
    nah(st.betrag, soll, 0.02);
  }
});

T('Sockel wirkt auf die Wahlrechte des § 32d EStG', () => {
  // Kleiner Gewinn, kein Sockel: die Guenstigerpruefung greift.
  const klein = basis({ gewinn: 45000, verguetung: 0, hebesatz: 400 });
  const ohne = berechne({ ...klein, optionen: { ...klein.optionen, guenstigerpruefung: true } });
  const ohneRef = berechne(klein);
  if (!(ohne.varianten.gmbh.barwert < ohneRef.varianten.gmbh.barwert - 0.01)) {
    throw new Error('Guenstigerpruefung greift ohne Sockel nicht');
  }
  // Derselbe Fall mit hohem Sockel: der Tarif liegt ueber 25 %, die
  // Guenstigerpruefung faellt auf die Abgeltungsteuer zurueck.
  const gross = basis({ gewinn: 45000, verguetung: 0, hebesatz: 400, weitereEinkuenfte: 120000 });
  const mit = berechne({ ...gross, optionen: { ...gross.optionen, guenstigerpruefung: true } });
  const mitRef = berechne(gross);
  nah(mit.varianten.gmbh.barwert, mitRef.varianten.gmbh.barwert, 0.01);
});

/* ---------------- Hebesatzstruktur ---------------- *
 *
 * Die folgenden Faelle sichern die Aussage der Arbeit zum Hebesatzeffekt ab.
 * Sie pruefen nicht einzelne Betraege, sondern die Gestalt der Belastungskurve:
 * den Knick bei 400 %, die Steigung links und rechts davon und die daraus
 * folgende Zweiseitigkeit des Vorteilsfensters.
 */

H('Sollwert 10 - Steigung der PersG oberhalb von 400 % ist der Messbetrag', () => {
  // Oberhalb von 400 % ist die Anrechnung auf 4 x Messbetrag eingefroren,
  // waehrend die Gewerbesteuer weiter mit h steigt. Je 100 Hebesatzpunkte
  // bleibt deshalb genau ein Messbetrag zusaetzlich haengen:
  //   G = 300.000, F = 24.500  ->  Messbetrag = 275.500 x 3,5 % = 9.642,50
  //   Belastung(500 %) ./. Belastung(450 %) = 0,5 x 9.642,50 = 4.821,25
  const m = (300000 - 24500) * 0.035;
  nah(m, 9642.5);
  for (const v of ['persG', 'persG34a']) {
    const a = berechne(basis({ hebesatz: 450 })).varianten[v].barwert;
    const b = berechne(basis({ hebesatz: 500 })).varianten[v].barwert;
    nah(b - a, 0.5 * m, 0.02);
  }
});

H('Sollwert 11 - Steigung der PersG unterhalb von 400 % ist allein der SolZ', () => {
  // Unterhalb von 400 % zehrt die Anrechnung die Gewerbesteuer vollstaendig auf.
  // Was bleibt, ist der Solidaritaetszuschlag auf die um die Anrechnung
  // geminderte Einkommensteuer; die Belastung sinkt also sogar leicht:
  //   d/dh = -5,5 % x Messbetrag je 100 Punkte = -0,055 x 9.642,50 = -530,34
  //   Belastung(350 %) ./. Belastung(300 %) = -0,5 x 530,34 = -265,17
  const m = (300000 - 24500) * 0.035;
  const a = berechne(basis({ hebesatz: 300 })).varianten.persG.barwert;
  const b = berechne(basis({ hebesatz: 350 })).varianten.persG.barwert;
  nah(b - a, -0.5 * 0.055 * m, 0.02);
});

T('Knick der PersG-Kurve liegt bei 400 %, nicht davor oder dahinter', () => {
  const steigung = (h1, h2) =>
    (berechne(basis({ hebesatz: h2 })).varianten.persG.barwert -
      berechne(basis({ hebesatz: h1 })).varianten.persG.barwert) /
    (h2 - h1);
  // Links des Knicks fallend, rechts steigend - und der Vorzeichenwechsel
  // findet zwischen 395 % und 405 % statt.
  if (!(steigung(300, 395) < 0)) throw new Error('Kurve faellt unterhalb 400 % nicht');
  if (!(steigung(405, 600) > 0)) throw new Error('Kurve steigt oberhalb 400 % nicht');
  if (!(steigung(380, 395) < 0)) throw new Error('Knick liegt zu frueh');
  if (!(steigung(405, 420) > 0)) throw new Error('Knick liegt zu spaet');
});

T('Lage des Knicks ist von Gewinn, Freibetrag und Vergütung unabhängig', () => {
  // 4 x Messbetrag = Messbetrag x h/100 kuerzt sich zu h = 400; der Messbetrag
  // selbst - und damit Gewinn, Freibetrag und Verguetung - faellt heraus.
  for (const gewinn of [60000, 300000, 2000000]) {
    for (const verguetung of [0, 150000]) {
      const vor = berechne(basis({ gewinn, verguetung, hebesatz: 395 })).varianten.persG.perioden[0];
      const nach = berechne(basis({ gewinn, verguetung, hebesatz: 405 })).varianten.persG.perioden[0];
      const holen = (p, l) => p.posten.find((x) => x.label === l).betrag;
      if (!(holen(vor, 'nachrichtlich: ungenutztes Anrechnungsvolumen (verfällt)') > 0.01)) {
        throw new Error(`kein verfallendes Volumen bei 395 % (G ${gewinn}, V ${verguetung})`);
      }
      if (!(holen(nach, 'nicht angerechnete Gewerbesteuer') > 0.01)) {
        throw new Error(`keine nicht angerechnete GewSt bei 405 % (G ${gewinn}, V ${verguetung})`);
      }
    }
  }
});

T('Kapitalgesellschaft verläuft ohne Knick linear im Hebesatz', () => {
  // Die GmbH kennt keine Anrechnung; ihre Belastung steigt gleichmaessig.
  // Die zweite Differenz muss daher ueber den Knick hinweg verschwinden.
  const b = (h) => berechne(basis({ hebesatz: h })).varianten.gmbh.barwert;
  const zweite = b(500) - 2 * b(400) + b(300);
  nah(zweite, 0, 0.02);
});

T('Vorteil der Personengesellschaft ist ein Fenster, keine Schwelle', () => {
  // Eine geknickte Kurve schneidet eine Gerade zweimal. Der Vorteil der
  // Personengesellschaft gegenueber der GmbH ist deshalb beidseitig begrenzt:
  // unterhalb des Fensters traegt die GmbH die niedrigere Gesamtbelastung,
  // oberhalb schlaegt die nicht angerechnete Gewerbesteuer durch.
  const szenario = {
    gewinn: 500000,
    verguetung: 100000,
    weitereEinkuenfte: 0,
    thesaurierungsquote: 0.5,
    kalkulationszins: 0.03,
    vonVz: 2026,
    bisVz: 2032,
    tarifVz: 2026,
    optionen: { ...PRUEF_OPTIONEN },
  };
  const vorteil = (h) => {
    const e = berechne({ ...szenario, hebesatz: h });
    return e.varianten.gmbh.barwert - e.varianten.persG.barwert;
  };
  let wechsel = 0;
  let vorher = Math.sign(vorteil(280));
  for (let h = 285; h <= 600; h += 5) {
    const jetzt = Math.sign(vorteil(h));
    if (jetzt !== vorher) wechsel += 1;
    vorher = jetzt;
  }
  gleich(wechsel, 2);
  // Innerhalb des Fensters guenstiger, an beiden Raendern des untersuchten
  // Bereichs unguenstiger.
  if (!(vorteil(400) > 0)) throw new Error('PersG bei 400 % nicht im Vorteil');
  if (!(vorteil(280) < 0)) throw new Error('PersG bei 280 % unerwartet im Vorteil');
  if (!(vorteil(600) < 0)) throw new Error('PersG bei 600 % unerwartet im Vorteil');
});

T('Bei vollständiger Thesaurierung gibt es kein Fenster der Regelbesteuerung', () => {
  // Ohne laufende Entnahme entfaellt der Stundungsvorteil der Thesaurierung
  // nicht, sondern wirkt allein zugunsten der Kapitalgesellschaft: die
  // Regelbesteuerung ist dann im gesamten untersuchten Bereich teurer.
  const szenario = {
    gewinn: 500000,
    verguetung: 100000,
    weitereEinkuenfte: 0,
    thesaurierungsquote: 1,
    kalkulationszins: 0.03,
    vonVz: 2026,
    bisVz: 2032,
    tarifVz: 2026,
    optionen: { ...PRUEF_OPTIONEN },
  };
  for (let h = 280; h <= 600; h += 10) {
    const e = berechne({ ...szenario, hebesatz: h });
    if (!(e.varianten.persG.barwert > e.varianten.gmbh.barwert)) {
      throw new Error(`Regelbesteuerung bei ${h} % unerwartet guenstiger als die GmbH`);
    }
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

/* ---------------- Veroeffentlichte Ergebnisse der Arbeit ---------------- *
 *
 * Dieser Abschnitt fixiert die in der Arbeit abgedruckten Zahlen. Er ist der
 * einzige, der bewusst STANDARD_SZENARIO verwendet: gepruefte Groesse ist hier
 * gerade, dass die Voreinstellung des Tools das Basisszenario aus Abschnitt 3.1
 * abbildet und die Tabelle der Arbeit reproduziert. Eine Aenderung der
 * Voreinstellungen MUSS diese Faelle brechen - sonst wuerde die Arbeit
 * stillschweigend von ihrer eigenen Datengrundlage abweichen.
 * ---------------------------------------------------------------------- */

H('Sollwert 14 - Tabelle 2 der Arbeit: alle neun Hebesatzzeilen', () => {
  // Barwert der Gesamtsteuerbelastung in % des Barwerts des Gewinns vor
  // Steuern, VZ 2026-2032, Basisszenario (G 500.000, V 100.000, Entnahmequote
  // 50 %, Zins 3 %). Werte wie in der Arbeit abgedruckt.
  const soll = [
    // Hebesatz, PersG Regel, PersG § 34a, GmbH/Option
    [280, 42.85, 42.03, 40.66],
    [320, 42.78, 41.96, 41.5],
    [360, 42.71, 41.9, 42.34],
    [400, 42.63, 41.84, 43.17],
    [440, 43.97, 43.18, 44.01],
    [480, 45.3, 44.52, 44.85],
    [520, 46.63, 45.86, 45.69],
    [560, 47.96, 47.2, 46.52],
    [600, 49.29, 48.54, 47.36],
  ];
  for (const [h, regel, a34, kap] of soll) {
    const e = berechne({ ...STANDARD_SZENARIO, hebesatz: h });
    const ist = (k) => Math.round(e.varianten[k].effektiv * 10000) / 100;
    for (const [k, s] of [['persG', regel], ['persG34a', a34], ['gmbh', kap], ['optierend', kap]]) {
      if (Math.abs(ist(k) - s) > 0.005) {
        throw new Error(`h = ${h} %, ${k}: erwartet ${s.toFixed(2)} %, erhalten ${ist(k).toFixed(2)} %`);
      }
    }
  }
});

T('Arbeit Abschnitt 3.2: Vorteilsfenster und Steigungen', () => {
  const eff = (e, k) => e.varianten[k].effektiv * 100;
  const bei = (h, ueb = {}) => berechne({ ...STANDARD_SZENARIO, hebesatz: h, ...ueb });

  // Steigung oberhalb von 400 %: rund 0,67 pp je 20 Hebesatzpunkte (PersG),
  // rund 0,42 pp je 20 Punkte bei der Kapitalgesellschaft.
  nah(eff(bei(440), 'persG') - eff(bei(420), 'persG'), 0.67, 0.01);
  nah(eff(bei(420), 'gmbh') - eff(bei(400), 'gmbh'), 0.42, 0.01);
  // § 34a verlaeuft rund 0,8 pp unterhalb der Regelbesteuerung.
  nah(eff(bei(400), 'persG') - eff(bei(400), 'persG34a'), 0.79, 0.02);

  // Zwei Schnittpunkte je Variante; Lage wie in Abschnitt 3.2 angegeben.
  const grenzen = (key) => {
    const g = [];
    let vor = null;
    for (let h = 280; h <= 600; h += 0.25) {
      const e = bei(h);
      const besser = e.varianten[key].barwert < e.varianten.gmbh.barwert;
      if (vor !== null && besser !== vor) g.push(h);
      vor = besser;
    }
    return g;
  };
  const gRegel = grenzen('persG');
  gleich(gRegel.length, 2);
  nah(gRegel[0], 376.5, 0.5);
  nah(gRegel[1], 444, 0.5);
  const g34a = grenzen('persG34a');
  gleich(g34a.length, 2);
  nah(g34a[0], 341, 0.5);
  nah(g34a[1], 507, 0.5);
});

T('Arbeit Abschnitt 3.2: Kontrollrechnung ohne Tätigkeitsvergütung', () => {
  const eff = (e, k) => e.varianten[k].effektiv * 100;
  const ohneV = (h) => berechne({ ...STANDARD_SZENARIO, verguetung: 0, hebesatz: h });
  // Bei 400 %: § 34a 41,97 % gegenüber GmbH 45,94 %.
  nah(eff(ohneV(400), 'persG34a'), 41.97, 0.005);
  nah(eff(ohneV(400), 'gmbh'), 45.94, 0.005);
  // Die GmbH ist nur noch unterhalb von rund 282 % günstiger als die
  // regelbesteuerte PersG.
  let wechsel = null;
  for (let h = 280; h <= 600 && wechsel === null; h += 0.5) {
    const e = ohneV(h);
    if (e.varianten.persG.barwert < e.varianten.gmbh.barwert) wechsel = h;
  }
  nah(wechsel, 282, 1);
  // § 34a unterbietet die GmbH im gesamten Bereich.
  for (let h = 280; h <= 600; h += 20) {
    const e = ohneV(h);
    if (!(e.varianten.persG34a.barwert < e.varianten.gmbh.barwert)) {
      throw new Error(`bei h = ${h} % ist § 34a nicht günstiger als die GmbH`);
    }
  }
});

T('Arbeit Abschnitt 3.2: Stundungsabhängigkeit und Entnahmequote', () => {
  const eff = (e, k) => e.varianten[k].effektiv * 100;
  const zins = (z) => berechne({ ...STANDARD_SZENARIO, kalkulationszins: z });
  // Bei Zins 0 liegt § 34a praktisch gleichauf mit der Regelbesteuerung.
  nah(eff(zins(0), 'persG34a'), 42.57, 0.005);
  nah(eff(zins(0), 'persG'), 42.63, 0.005);
  nah(eff(zins(0.06), 'persG34a'), 41.16, 0.005);

  // Nicht monotoner Verlauf über die Entnahmequote mit Minimum bei rund 53 %.
  // Die Quote des Szenarios ist die Thesaurierungsquote: q = 1 - Entnahmequote.
  const beiQuote = (entnahmeProzent) =>
    eff(berechne({ ...STANDARD_SZENARIO, thesaurierungsquote: 1 - entnahmeProzent / 100 }), 'persG34a');
  let best = null;
  for (let q = 0; q <= 100; q += 0.5) {
    const v = beiQuote(q);
    if (best === null || v < best[1]) best = [q, v];
  }
  nah(best[0], 53, 1);
  // Bei vollständiger Thesaurierung 42,27 %, unter der Regelbesteuerung.
  nah(beiQuote(0), 42.27, 0.005);
  if (!(beiQuote(0) < eff(berechne(STANDARD_SZENARIO), 'persG'))) {
    throw new Error('volle Thesaurierung müsste unter der Regelbesteuerung liegen');
  }
});

T('Arbeit Abschnitt 2.5: Einbeziehung in den Hoechstbetrag wirkt rund 7,5 pp', () => {
  // Der in Abschnitt 2.5 berichtete Befund: ohne Einbeziehung der
  // Thesaurierungssteuer war die Belastung der PersG bei vollständiger
  // Thesaurierung um rund 7,5 Prozentpunkte überhöht.
  const s = { ...STANDARD_SZENARIO, thesaurierungsquote: 1 };
  const mit = berechne(s).varianten.persG34a.effektiv * 100;
  const ohne = berechne({
    ...s,
    optionen: { ...STANDARD_SZENARIO.optionen, est34aImHoechstbetrag: false },
  }).varianten.persG34a.effektiv * 100;
  nah(ohne - mit, 7.5, 0.1);
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
