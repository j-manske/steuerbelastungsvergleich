/**
 * Berechnungskern des Steuerbelastungsvergleichs.
 *
 * Der Kern ist zustandsfrei: `berechne(szenario)` liefert zu einem Szenario das
 * vollstaendige Ergebnis fuer alle vier Auspraegungen. Die Oberflaeche haelt
 * keinerlei Rechenlogik.
 *
 * Auspraegungen (Abschnitt 2.1 der Arbeit):
 *   persG      Personengesellschaft, Regelbesteuerung (§§ 15, 32a, 35 EStG)
 *   persG34a   Personengesellschaft mit Thesaurierungsbegünstigung (§ 34a EStG)
 *   gmbh       GmbH (§§ 1, 23 KStG, § 32d EStG)
 *   optierend  optierende Gesellschaft (§ 1a KStG)
 */

import { KONSTANTEN, REFERENZ_TARIF_VZ, rechtsstand } from './rates.js';
import {
  estTarif,
  solzAufEst,
  solzPauschal,
  gewerbesteuer,
  ermaessigung35,
} from './tarif.js';

export const VARIANTEN = [
  {
    key: 'persG',
    label: 'Personengesellschaft (Regelbesteuerung)',
    kurz: 'PersG Regel',
    farbe: '#2563eb',
  },
  {
    key: 'persG34a',
    label: 'Personengesellschaft mit § 34a EStG',
    kurz: 'PersG § 34a',
    farbe: '#0d9488',
  },
  { key: 'gmbh', label: 'GmbH', kurz: 'GmbH', farbe: '#db2777' },
  {
    key: 'optierend',
    label: 'Optierende Gesellschaft (§ 1a KStG)',
    kurz: '§ 1a KStG',
    farbe: '#ea580c',
    // Gestrichelt, weil die Kurve unter den Basisannahmen deckungsgleich mit
    // der GmbH verlaeuft und andernfalls verdeckt wuerde.
    strich: '7 4',
  },
];

export const STANDARD_OPTIONEN = {
  /** SolZ-Freigrenze und Milderungszone auf die Einkommensteuer anwenden. */
  solzFreigrenze: true,
  /** Gesetzlichen Mindesthebesatz je VZ erzwingen (§ 16 Abs. 4 S. 2 GewStG). */
  mindesthebesatzErzwingen: true,
  /** Steuer nach § 34a Abs. 1 EStG in den Ermäßigungshöchstbetrag des
   *  § 35 EStG einbeziehen. Standard: ja */
  est34aImHoechstbetrag: true,
  /** Ausschüttungsfiktion des § 1a Abs. 3 S. 5 KStG bei entnahmefaehigem
   *  Gesellschafterkonto - Thesaurierung dann nicht moeglich. */
  ausschuettungsfiktion1a: false,
  /** Vollstaendige Entnahme bzw. Ausschüttung in der Schlussperiode. */
  schlussausschuettung: true,
};

export const STANDARD_SZENARIO = {
  gewinn: 300000,
  /**
   * Fremduebliches Geschaeftsfuehrergehalt, in allen Auspraegungen betragsgleich
   * (Abschnitt 2.2 der Arbeit). Der vollstaendige Verzicht auf eine Verguetung
   * dient in Kapitel 3 nur noch als Kontrollrechnung.
   */
  verguetung: 120000,
  thesaurierungsquote: 1,
  hebesatz: 400,
  kalkulationszins: 0.03,
  vonVz: 2026,
  bisVz: 2032,
  tarifVz: REFERENZ_TARIF_VZ,
  optionen: { ...STANDARD_OPTIONEN },
};

const EPS = 1e-6;

function posten(label, betrag, norm, ebene) {
  return { label, betrag, norm, ebene };
}

function hebesatzFuer(vz, szenario) {
  const mindest = rechtsstand(vz).gewstMindesthebesatz;
  if (!szenario.optionen.mindesthebesatzErzwingen) {
    return { hebesatz: szenario.hebesatz, angehoben: false, mindest };
  }
  const hebesatz = Math.max(szenario.hebesatz, mindest);
  return { hebesatz, angehoben: hebesatz > szenario.hebesatz + EPS, mindest };
}

/* ------------------------------------------------------------------ *
 * Personengesellschaft - Regelbesteuerung
 * ------------------------------------------------------------------ */

function periodePersG(vz, szenario, state, istSchluss) {
  const G = szenario.gewinn;
  const V = szenario.verguetung;
  const hs = hebesatzFuer(vz, szenario);
  const solzOpt = { freigrenze: szenario.optionen.solzFreigrenze, tarifVz: szenario.tarifVz };

  const gew = gewerbesteuer(G, KONSTANTEN.gewstFreibetragPersG, hs.hebesatz);

  // Transparenzprinzip: der gesamte Gewinn einschliesslich der Sondervergütung
  // (§ 15 Abs. 1 S. 1 Nr. 2 EStG) ist gewerbliche Einkunft des Gesellschafters.
  // Die Gewerbesteuer ist nach § 4 Abs. 5b EStG nicht abziehbar.
  const zvE = G;
  const estTariflich = estTarif(zvE, szenario.tarifVz);
  const erm = ermaessigung35(gew.messbetrag, gew.steuer, estTariflich);
  const estFestgesetzt = Math.max(0, estTariflich - erm.anrechnung);
  const solz = solzAufEst(estFestgesetzt, solzOpt);

  const gesamt = gew.steuer + estFestgesetzt + solz;

  return {
    vz,
    hebesatz: hs,
    gesamt,
    komponenten: {
      gewerbesteuer: gew.steuer,
      koerperschaftsteuer: 0,
      einkommensteuer: estFestgesetzt,
      abgeltungsteuer: 0,
      solz,
    },
    posten: [
      posten('Gewinn vor Steuern', G, null, 'nachrichtlich'),
      posten('davon Tätigkeitsvergütung (Sondervergütung)', V, '§ 15 Abs. 1 S. 1 Nr. 2 EStG', 'nachrichtlich'),
      posten('Gewerbeertrag', gew.gewerbeertrag, '§ 7 GewStG', 'gesellschaft'),
      posten('abgerundet auf volle 100 EUR', gew.abgerundet, '§ 11 Abs. 1 S. 3 GewStG', 'gesellschaft'),
      posten('./. Freibetrag', -gew.freibetrag, '§ 11 Abs. 1 S. 3 Nr. 1 GewStG', 'gesellschaft'),
      posten('Steuermessbetrag (3,5 %)', gew.messbetrag, '§ 11 Abs. 2 GewStG', 'gesellschaft'),
      posten(`Gewerbesteuer (Hebesatz ${hs.hebesatz} %)`, gew.steuer, '§ 16 GewStG', 'gesellschaft'),
      posten('zu versteuerndes Einkommen', zvE, '§ 2 Abs. 5 EStG', 'gesellschafter'),
      posten('tarifliche Einkommensteuer', estTariflich, '§ 32a EStG', 'gesellschafter'),
      posten('Anrechnungsvolumen (4 × Messbetrag)', erm.anrechnungsvolumen, '§ 35 Abs. 1 EStG', 'gesellschafter'),
      posten('Ermäßigungshöchstbetrag', erm.ermaessigungshoechstbetrag, '§ 35 Abs. 1 S. 5 EStG', 'gesellschafter'),
      posten('./. Steuerermäßigung', -erm.anrechnung, '§ 35 Abs. 1 EStG', 'gesellschafter'),
      posten('Anrechnungsüberhang (verfällt)', erm.ueberhang, '§ 35 EStG - kein Vor-/Rücktrag', 'gesellschafter'),
      posten('festzusetzende Einkommensteuer', estFestgesetzt, '§ 2 Abs. 6 EStG', 'gesellschafter'),
      posten('Solidaritätszuschlag', solz, '§ 4 SolZG', 'gesellschafter'),
      posten('Gesamtbelastung der Periode', gesamt, null, 'summe'),
    ],
    hinweise: erm.ueberhang > EPS ? [`Anrechnungsüberhang: ${erm.ueberhangUrsache}`] : [],
    zustand: { ...state },
  };
}

/* ------------------------------------------------------------------ *
 * Personengesellschaft - Thesaurierungsbeguenstigung § 34a EStG
 * ------------------------------------------------------------------ */

function periodePersG34a(vz, szenario, state, istSchluss) {
  const G = szenario.gewinn;
  const V = szenario.verguetung;
  const t = szenario.thesaurierungsquote;
  const rs = rechtsstand(vz);
  const hs = hebesatzFuer(vz, szenario);
  const solzOpt = { freigrenze: szenario.optionen.solzFreigrenze, tarifVz: szenario.tarifVz };

  const gew = gewerbesteuer(G, KONSTANTEN.gewstFreibetragPersG, hs.hebesatz);

  // Frei disponible Entnahme: Quote auf den nach Gewerbesteuer verbleibenden
  // Gewinn nach Tätigkeitsvergütung - symmetrisch zur Ausschüttungsquote
  // der Kapitalgesellschaft.
  const entnahmefaehig = Math.max(0, G - V - gew.steuer);
  const entnahmeFrei = (1 - t) * entnahmefaehig;

  // Zirkularitaet des § 34a Abs. 2 EStG: der beguenstigungsfaehige Gewinn ist
  // um die zur Zahlung der Gewerbe- und der Thesaurierungssteuer entnommenen
  // Betraege zu erhoehen, die Thesaurierungssteuer folgt aber erst aus ihm.
  // Aufloesung durch Fixpunktiteration (Abschnitt 2.4 der Arbeit).
  let steuerentnahme = 0;
  let iterationen = 0;
  let lauf = null;
  for (let i = 0; i < 50; i++) {
    iterationen = i + 1;
    const entnahmen = V + entnahmeFrei + gew.steuer + steuerentnahme;
    const nichtEntnommenerGewinn = G - entnahmen;
    const beguenstigungsfaehig = Math.max(0, nichtEntnommenerGewinn + gew.steuer + steuerentnahme);
    const B = beguenstigungsfaehig; // voller Antrag
    const regelbesteuert = Math.max(0, G - B);

    const estTariflich = estTarif(regelbesteuert, szenario.tarifVz);
    const est34a = rs.thesaurierung34a * B;
    const solz34a = solzPauschal(est34a);

    const hoechstbetrag = szenario.optionen.est34aImHoechstbetrag
      ? estTariflich + est34a
      : estTariflich;
    const erm = ermaessigung35(gew.messbetrag, gew.steuer, hoechstbetrag);

    lauf = {
      entnahmen,
      nichtEntnommenerGewinn,
      beguenstigungsfaehig,
      B,
      regelbesteuert,
      estTariflich,
      est34a,
      solz34a,
      erm,
    };

    const neu = est34a + solz34a;
    if (Math.abs(neu - steuerentnahme) < 0.01) break;
    steuerentnahme = neu;
  }

  const { B, regelbesteuert, estTariflich, est34a, solz34a, erm } = lauf;
  const estFestgesetzt = Math.max(0, estTariflich + est34a - erm.anrechnung);
  const solz = solzAufEst(estFestgesetzt, solzOpt);

  // Nachversteuerung (§ 34a Abs. 4 EStG): laufender Entnahmeueberhang gegen den
  // zum Ende des Vorjahres festgestellten nachversteuerungspflichtigen Betrag.
  const entnahmenGesamt = V + entnahmeFrei + gew.steuer + est34a + solz34a;
  const ueberhang = Math.max(0, entnahmenGesamt - G);
  let nachversteuerungsbetrag = Math.min(state.nvB, ueberhang);

  const zugangNvB = Math.max(0, B - est34a - solz34a);
  let nvB = state.nvB - nachversteuerungsbetrag + zugangNvB;

  let schlussNachversteuerung = 0;
  if (istSchluss && szenario.optionen.schlussausschuettung) {
    schlussNachversteuerung = nvB;
    nvB = 0;
  }

  const nvGesamt = nachversteuerungsbetrag + schlussNachversteuerung;
  const nvSteuer = KONSTANTEN.nachversteuerungssatz34a * nvGesamt;
  const solzNv = solzPauschal(nvSteuer);

  const gesamt = gew.steuer + estFestgesetzt + solz + nvSteuer + solzNv;

  return {
    vz,
    hebesatz: hs,
    gesamt,
    komponenten: {
      gewerbesteuer: gew.steuer,
      koerperschaftsteuer: 0,
      einkommensteuer: estFestgesetzt + nvSteuer,
      abgeltungsteuer: 0,
      solz: solz + solzNv,
    },
    posten: [
      posten('Gewinn vor Steuern', G, null, 'nachrichtlich'),
      posten('Gewerbeertrag', gew.gewerbeertrag, '§ 7 GewStG', 'gesellschaft'),
      posten('Steuermessbetrag', gew.messbetrag, '§ 11 Abs. 2 GewStG', 'gesellschaft'),
      posten(`Gewerbesteuer (Hebesatz ${hs.hebesatz} %)`, gew.steuer, '§ 16 GewStG', 'gesellschaft'),
      posten('Tätigkeitsvergütung (Entnahme)', V, '§ 15 Abs. 1 S. 1 Nr. 2 EStG', 'gesellschafter'),
      posten('frei disponible Entnahme', entnahmeFrei, '§ 34a Abs. 2 EStG', 'gesellschafter'),
      posten('Entnahmen insgesamt', entnahmenGesamt, '§ 34a Abs. 2 EStG', 'gesellschafter'),
      posten('nicht entnommener Gewinn', G - entnahmenGesamt, '§ 34a Abs. 2 S. 1 EStG', 'gesellschafter'),
      posten('begünstigungsfähiger Gewinn', B, '§ 34a Abs. 2 S. 2 EStG', 'gesellschafter'),
      posten('regelbesteuerter Gewinnanteil', regelbesteuert, '§ 32a EStG', 'gesellschafter'),
      posten('tarifliche Einkommensteuer', estTariflich, '§ 32a EStG', 'gesellschafter'),
      posten(
        `Thesaurierungssteuer (${(rs.thesaurierung34a * 100).toFixed(2).replace('.', ',')} %)`,
        est34a,
        '§ 34a Abs. 1 EStG',
        'gesellschafter'
      ),
      posten('Ermäßigungshöchstbetrag', erm.ermaessigungshoechstbetrag, '§ 35 Abs. 1 S. 5 EStG', 'gesellschafter'),
      posten('./. Steuerermäßigung', -erm.anrechnung, '§ 35 Abs. 1 EStG', 'gesellschafter'),
      posten('Anrechnungsüberhang (verfällt)', erm.ueberhang, '§ 35 EStG', 'gesellschafter'),
      posten('festzusetzende Einkommensteuer', estFestgesetzt, '§ 2 Abs. 6 EStG', 'gesellschafter'),
      posten('Solidaritätszuschlag', solz, '§ 4 SolZG', 'gesellschafter'),
      posten('Nachversteuerungsbetrag', nvGesamt, '§ 34a Abs. 4 EStG', 'gesellschafter'),
      posten('Nachversteuerung (25 %) zzgl. SolZ', nvSteuer + solzNv, '§ 34a Abs. 4 EStG', 'gesellschafter'),
      posten('nachversteuerungspflichtiger Betrag (Endbestand)', nvB, '§ 34a Abs. 3 EStG', 'nachrichtlich'),
      posten('Gesamtbelastung der Periode', gesamt, null, 'summe'),
    ],
    hinweise: [
      `Fixpunktiteration konvergiert nach ${iterationen} Durchläufen.`,
      ...(erm.ueberhang > EPS ? [`Anrechnungsüberhang: ${erm.ueberhangUrsache}`] : []),
      ...(schlussNachversteuerung > EPS
        ? ['Schlussperiode: vollständige Entnahme, Nachversteuerung des Restbestands.']
        : []),
    ],
    zustand: { nvB },
  };
}

/* ------------------------------------------------------------------ *
 * GmbH und optierende Gesellschaft
 * ------------------------------------------------------------------ */

function periodeKapGes(vz, szenario, state, istSchluss, variante) {
  const G = szenario.gewinn;
  const V = szenario.verguetung;
  const rs = rechtsstand(vz);
  const hs = hebesatzFuer(vz, szenario);
  const solzOpt = { freigrenze: szenario.optionen.solzFreigrenze, tarifVz: szenario.tarifVz };
  const istOption = variante === 'optierend';
  const fiktion = istOption && szenario.optionen.ausschuettungsfiktion1a;

  // Die Tätigkeitsvergütung ist abziehbare Betriebsausgabe - bei der GmbH
  // dem Grunde nach, bei der optierenden Gesellschaft ueber
  // § 1a Abs. 3 S. 2 Nr. 2 KStG. Kein Freibetrag (§ 11 Abs. 1 S. 3 Nr. 1 GewStG).
  const bemessung = Math.max(0, G - V);
  const gew = gewerbesteuer(bemessung, 0, hs.hebesatz);
  const kst = rs.kst * bemessung;
  const solzKst = solzPauschal(kst);

  const jahresueberschuss = bemessung - gew.steuer - kst - solzKst;

  let ausschuettung;
  if (istSchluss && szenario.optionen.schlussausschuettung) {
    ausschuettung = Math.max(0, jahresueberschuss) + state.bestand;
  } else if (fiktion) {
    ausschuettung = Math.max(0, jahresueberschuss);
  } else {
    ausschuettung = (1 - szenario.thesaurierungsquote) * Math.max(0, jahresueberschuss);
  }
  const thesaurierung = Math.max(0, jahresueberschuss) - Math.min(ausschuettung, Math.max(0, jahresueberschuss));
  const bestandNeu = istSchluss && szenario.optionen.schlussausschuettung ? 0 : state.bestand + thesaurierung;

  // Gesellschafterebene
  const estGehalt = estTarif(V, szenario.tarifVz);
  const solzGehalt = solzAufEst(estGehalt, solzOpt);
  const kapEst = KONSTANTEN.abgeltungsteuerSatz * ausschuettung;
  const solzKap = solzPauschal(kapEst);

  const gesamt = gew.steuer + kst + solzKst + estGehalt + solzGehalt + kapEst + solzKap;

  return {
    vz,
    hebesatz: hs,
    gesamt,
    komponenten: {
      gewerbesteuer: gew.steuer,
      koerperschaftsteuer: kst,
      einkommensteuer: estGehalt,
      abgeltungsteuer: kapEst,
      solz: solzKst + solzGehalt + solzKap,
    },
    posten: [
      posten('Gewinn vor Steuern und Vergütung', G, null, 'nachrichtlich'),
      posten(
        './. Tätigkeitsvergütung / Geschäftsführergehalt',
        -V,
        istOption ? '§ 1a Abs. 3 S. 2 Nr. 2 KStG' : '§ 8 Abs. 3 S. 2 KStG (Fremdüblichkeit)',
        'gesellschaft'
      ),
      posten('Gewerbeertrag = Einkommen', bemessung, '§ 7 GewStG, § 8 KStG', 'gesellschaft'),
      posten('Steuermessbetrag (ohne Freibetrag)', gew.messbetrag, '§ 11 GewStG', 'gesellschaft'),
      posten(`Gewerbesteuer (Hebesatz ${hs.hebesatz} %)`, gew.steuer, '§ 16 GewStG', 'gesellschaft'),
      posten(
        `Körperschaftsteuer (${(rs.kst * 100).toFixed(0)} %)`,
        kst,
        '§ 23 Abs. 1 KStG',
        'gesellschaft'
      ),
      posten('Solidaritätszuschlag auf KSt', solzKst, '§ 4 SolZG', 'gesellschaft'),
      posten('Jahresüberschuss nach Steuern', jahresueberschuss, null, 'gesellschaft'),
      posten('Thesaurierung', thesaurierung, null, 'gesellschaft'),
      posten('Ausschüttung', ausschuettung, istOption ? '§ 1a Abs. 3 S. 5 KStG' : '§ 20 Abs. 1 Nr. 1 EStG', 'gesellschaft'),
      posten('thesauriertes Vermögen (Endbestand)', bestandNeu, null, 'nachrichtlich'),
      posten('Einkommensteuer auf Gehalt', estGehalt, '§ 19, § 32a EStG', 'gesellschafter'),
      posten('SolZ auf Gehalt', solzGehalt, '§ 4 SolZG', 'gesellschafter'),
      posten('Abgeltungsteuer (25 %)', kapEst, '§ 32d Abs. 1 EStG', 'gesellschafter'),
      posten('SolZ auf Abgeltungsteuer', solzKap, '§ 4 SolZG', 'gesellschafter'),
      posten('Gesamtbelastung der Periode', gesamt, null, 'summe'),
    ],
    hinweise: [
      ...(fiktion && !istSchluss
        ? ['Ausschüttungsfiktion § 1a Abs. 3 S. 5 KStG: Thesaurierung ausgeschlossen.']
        : []),
      ...(istSchluss && szenario.optionen.schlussausschuettung
        ? ['Schlussperiode: Ausschüttung des gesamten thesaurierten Vermögens.']
        : []),
    ],
    zustand: { bestand: bestandNeu },
  };
}

/* ------------------------------------------------------------------ *
 * Mehrperiodenlauf
 * ------------------------------------------------------------------ */

const RECHNER = {
  persG: (vz, s, st, ende) => periodePersG(vz, s, st, ende),
  persG34a: (vz, s, st, ende) => periodePersG34a(vz, s, st, ende),
  gmbh: (vz, s, st, ende) => periodeKapGes(vz, s, st, ende, 'gmbh'),
  optierend: (vz, s, st, ende) => periodeKapGes(vz, s, st, ende, 'optierend'),
};

const STARTZUSTAND = { nvB: 0, bestand: 0 };

function laufeVariante(key, szenario) {
  const rechner = RECHNER[key];
  let zustand = { ...STARTZUSTAND };
  const perioden = [];
  for (let vz = szenario.vonVz; vz <= szenario.bisVz; vz++) {
    const istSchluss = vz === szenario.bisVz;
    const p = rechner(vz, szenario, zustand, istSchluss);
    zustand = { ...zustand, ...p.zustand };
    perioden.push(p);
  }

  const i = szenario.kalkulationszins;
  let barwert = 0;
  let nominal = 0;
  perioden.forEach((p, idx) => {
    // Zahlung am Ende der Periode, Bezugszeitpunkt ist der Beginn des ersten VZ.
    p.diskontfaktor = 1 / Math.pow(1 + i, idx + 1);
    p.barwert = p.gesamt * p.diskontfaktor;
    barwert += p.barwert;
    nominal += p.gesamt;
  });

  const anzahl = perioden.length;
  let barwertGewinn = 0;
  for (let idx = 0; idx < anzahl; idx++) {
    barwertGewinn += szenario.gewinn / Math.pow(1 + i, idx + 1);
  }

  return {
    key,
    ...VARIANTEN.find((v) => v.key === key),
    perioden,
    nominal,
    barwert,
    barwertGewinn,
    effektiv: barwertGewinn > 0 ? barwert / barwertGewinn : 0,
    stundungseffekt: nominal - barwert,
  };
}

export function berechne(eingabe) {
  const szenario = {
    ...STANDARD_SZENARIO,
    ...eingabe,
    optionen: { ...STANDARD_OPTIONEN, ...(eingabe?.optionen ?? {}) },
  };
  if (szenario.bisVz < szenario.vonVz) szenario.bisVz = szenario.vonVz;
  szenario.verguetung = Math.min(szenario.verguetung, szenario.gewinn);

  const varianten = {};
  for (const v of VARIANTEN) varianten[v.key] = laufeVariante(v.key, szenario);

  const rangfolge = Object.values(varianten)
    .slice()
    .sort((a, b) => a.barwert - b.barwert)
    .map((v) => v.key);

  const beste = varianten[rangfolge[0]];
  Object.values(varianten).forEach((v) => {
    v.rang = rangfolge.indexOf(v.key) + 1;
    v.abstandZumBesten = v.barwert - beste.barwert;
  });

  const hebesaetze = [];
  for (let vz = szenario.vonVz; vz <= szenario.bisVz; vz++) hebesaetze.push(hebesatzFuer(vz, szenario));

  return { szenario, varianten, rangfolge, hebesaetze };
}

/**
 * Sensitivitaetsanalyse: variiert allein den Hebesatz und liefert je
 * Auspraegung den Barwert der Gesamtsteuerbelastung.
 */
export function sensitivitaet(szenario, { von = 280, bis = 600, schritt = 5 } = {}) {
  const punkte = [];
  for (let h = von; h <= bis + EPS; h += schritt) {
    const hebesatz = Math.round(h);
    const e = berechne({ ...szenario, hebesatz });
    const werte = {};
    for (const v of VARIANTEN) {
      werte[v.key] = {
        barwert: e.varianten[v.key].barwert,
        effektiv: e.varianten[v.key].effektiv,
      };
    }
    punkte.push({ hebesatz, werte });
  }
  return { punkte, schnittpunkte: findeSchnittpunkte(punkte) };
}

/** Hebesaetze, an denen die Rangfolge der beiden guenstigsten Formen wechselt. */
function findeSchnittpunkte(punkte) {
  const treffer = [];
  for (let i = 1; i < punkte.length; i++) {
    for (const a of VARIANTEN) {
      for (const b of VARIANTEN) {
        if (a.key >= b.key) continue;
        const d0 = punkte[i - 1].werte[a.key].barwert - punkte[i - 1].werte[b.key].barwert;
        const d1 = punkte[i].werte[a.key].barwert - punkte[i].werte[b.key].barwert;
        if (d0 === 0 || d1 === 0) continue;
        if (Math.sign(d0) !== Math.sign(d1)) {
          const h0 = punkte[i - 1].hebesatz;
          const h1 = punkte[i].hebesatz;
          const h = h0 + ((h1 - h0) * Math.abs(d0)) / (Math.abs(d0) + Math.abs(d1));
          treffer.push({ a: a.key, b: b.key, hebesatz: h });
        }
      }
    }
  }
  return treffer;
}
