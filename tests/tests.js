/**
 * Kontrollfaelle zur Absicherung des Berechnungskerns.
 * Die Sollwerte sind manuell gerechnet; sie decken insbesondere die Grenzen des
 * Anrechnungsvolumens nach § 35 EStG und den Uebergang zum Mindesthebesatz ab.
 */

import { berechne, STANDARD_SZENARIO } from '../src/core/model.js';
import { estTarif, gewerbesteuer, ermaessigung35, solzAufEst } from '../src/core/tarif.js';
import { rechtsstand } from '../src/core/rates.js';

const faelle = [];
const T = (name, fn) => faelle.push({ name, fn });

function nah(ist, soll, toleranz = 0.01) {
  if (Math.abs(ist - soll) > toleranz) {
    throw new Error(`erwartet ${soll.toFixed(2)}, erhalten ${ist.toFixed(2)}`);
  }
}
function gleich(ist, soll) {
  if (ist !== soll) throw new Error(`erwartet ${soll}, erhalten ${ist}`);
}

const basis = (ueberschreibungen = {}) => ({
  ...STANDARD_SZENARIO,
  gewinn: 300000,
  verguetung: 0,
  thesaurierungsquote: 1,
  hebesatz: 400,
  kalkulationszins: 0,
  vonVz: 2026,
  bisVz: 2026,
  ...ueberschreibungen,
  optionen: { ...STANDARD_SZENARIO.optionen, ...(ueberschreibungen.optionen ?? {}) },
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
  const e = berechne(basis({ optionen: { schlussausschuettung: false } }));
  const p = e.varianten.persG34a.perioden[0];
  const beguenstigt = p.posten.find((x) => x.label === 'begünstigungsfähiger Gewinn');
  nah(beguenstigt.betrag, 300000, 1);
  nah(p.komponenten.gewerbesteuer, 38570);
  // 28,25 % Thesaurierungssteuer, kein regelbesteuerter Anteil
  nah(p.gesamt, 38570 + 84750 + 0.055 * 84750);
});

T('§ 34a EStG: voller Sondertarif zehrt den Ermäßigungshöchstbetrag auf', () => {
  const e = berechne(basis({ optionen: { schlussausschuettung: false } }));
  const p = e.varianten.persG34a.perioden[0];
  const ueberhang = p.posten.find((x) => x.label.startsWith('Anrechnungsüberhang'));
  nah(ueberhang.betrag, 4 * 9642.5, 1);
});

T('§ 34a EStG: Option "im Hoechstbetrag" stellt die Anrechnung wieder her', () => {
  const e = berechne(
    basis({ optionen: { schlussausschuettung: false, est34aImHoechstbetrag: true } })
  );
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
      return { name: f.name, ok: true };
    } catch (fehler) {
      return { name: f.name, ok: false, fehler: fehler.message };
    }
  });
  return {
    ergebnisse,
    bestanden: ergebnisse.filter((r) => r.ok).length,
    gesamt: ergebnisse.length,
  };
}
