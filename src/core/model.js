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
  /** Antrag auf Teileinkuenfteverfahren (§ 32d Abs. 2 Nr. 3 EStG) statt des
   *  gesonderten Tarifs. Standard: nein (Tabelle 2 der Arbeit). */
  teileinkuenfte: false,
  /** Guenstigerpruefung nach § 32d Abs. 6 EStG. Standard: nein. */
  guenstigerpruefung: false,
  /** Vollstaendige Entnahme bzw. Ausschüttung in der Schlussperiode. */
  schlussausschuettung: true,
};

/**
 * Basisszenario nach Abschnitt 3.1 der Arbeit. Der Gewinn ist bewusst so
 * gewaehlt, dass der Gesellschafter in allen Auspraegungen in der oberen
 * Proportionalzone des Tarifs liegt.
 */
export const STANDARD_SZENARIO = {
  gewinn: 500000,
  /**
   * Fremduebliches Geschaeftsfuehrergehalt, in allen Auspraegungen betragsgleich
   * (Abschnitt 2.2). Der Verzicht auf eine Verguetung dient als Kontrollrechnung.
   */
  verguetung: 100000,
  /**
   * Weitere tarifliche Einkuenfte des Gesellschafters (Sockelbetrag).
   * Voreinstellung 0 nach Tabelle 2 der Arbeit: keine weiteren Einkuenfte.
   */
  weitereEinkuenfte: 0,
  /** Entnahme- bzw. Ausschuettungsquote 50 % (Abschnitt 3.1). */
  thesaurierungsquote: 0.5,
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

/* ------------------------------------------------------------------ *
 * Weitere Einkuenfte des Gesellschafters (Sockelmodell)
 *
 * Weitere tarifliche Einkuenfte W wirken im Modell als Sockel: sie verbrauchen
 * die unteren Tarifzonen und heben damit den Grenzsteuersatz, mit dem das
 * Betriebsergebnis belastet wird. Die auf W selbst entfallende Steuer bleibt
 * aus dem Vergleich heraus, denn verglichen werden soll allein die Belastung
 * des Gewinns. Zugerechnet wird deshalb stets die Differenz
 *
 *     ESt(W + X) - ESt(W)
 *
 * und ebenso beim Solidaritaetszuschlag. Fuer W = 0 faellt das exakt auf die
 * bisherige Rechnung zurueck; die Voreinstellung bleibt unveraendert.
 *
 * Der Sockel wirkt nur auf tariflich besteuerte Groessen. Der gesonderte Tarif
 * des § 32d Abs. 1 EStG, der Sondertarif des § 34a Abs. 1 EStG und die
 * Nachversteuerung nach § 34a Abs. 4 EStG bleiben unberuehrt.
 * ------------------------------------------------------------------ */

function sockel(szenario) {
  return Math.max(0, szenario.weitereEinkuenfte ?? 0);
}

/**
 * Hebesatz, bei dem das Anrechnungsvolumen des § 35 EStG die gezahlte
 * Gewerbesteuer genau deckt.
 *
 * Aus 4 x Messbetrag = Messbetrag x h/100 folgt h = 400 % - unabhaengig von
 * Gewinn, Freibetrag und Vergütung. Unterhalb dieses Werts verfaellt
 * Anrechnungsvolumen mangels dahinterstehender Gewerbesteuer, oberhalb bleibt
 * die ueberschiessende Gewerbesteuer endgueltige Belastung. Die Belastungskurve
 * der Personengesellschaften hat hier deshalb einen Knick.
 *
 * Der Ermaessigungshoechstbetrag des § 35 Abs. 1 S. 2 EStG wirkt daneben und
 * hebesatzunabhaengig; bindet er, bleibt auch unterhalb von 400 % Gewerbesteuer
 * endgueltig. Der Knick verschiebt sich dadurch nicht, die Kurve verlaeuft
 * lediglich insgesamt hoeher.
 */
export const KNICK_HEBESATZ = KONSTANTEN.anrechnungsfaktor35 * 100;

/** Betrag im deutschen Format fuer die Hinweistexte. */
function eurText(v) {
  return `${v.toFixed(2).replace('.', ',')} EUR`;
}

/**
 * Hinweise zu den Grenzen des § 35 EStG.
 *
 * Die beiden ausgewiesenen Groessen ueberschneiden sich, wenn der
 * Ermaessigungshoechstbetrag bindet: der davon blockierte Teil ist sowohl
 * ungenutztes Anrechnungsvolumen als auch nicht angerechnete Gewerbesteuer.
 * Die Hinweise benennen deshalb die Ursachen einzeln mit Betrag, statt eine
 * Zuordnung zum Hebesatzbereich zu behaupten, die nur dann zutrifft, wenn der
 * Hoechstbetrag nicht bindet.
 */
function hinweise35(erm) {
  const texte = [];
  if (erm.ueberhang > EPS || erm.nichtAngerechneteGewSt > EPS) {
    const teile = [];
    if (erm.ohneGewSt > EPS) {
      teile.push(
        `${eurText(erm.ohneGewSt)} Anrechnungsvolumen ohne dahinterstehende Gewerbesteuer ` +
          '(Hebesatz unter 400 %, § 35 Abs. 1 S. 5 EStG)'
      );
    }
    if (erm.ueberVolumen > EPS) {
      teile.push(
        `${eurText(erm.ueberVolumen)} Gewerbesteuer über dem Volumen von 4 × Messbetrag ` +
          '(Hebesatz über 400 %, § 35 Abs. 1 S. 1 Nr. 1 EStG)'
      );
    }
    if (erm.durchHoechstbetrag > EPS) {
      teile.push(
        `${eurText(erm.durchHoechstbetrag)} durch den Ermäßigungshöchstbetrag blockiert ` +
          '(§ 35 Abs. 1 S. 2 EStG)'
      );
    }
    texte.push(`Grenzen des § 35 EStG: ${teile.join('; ')}.`);
  }
  if (erm.durchHoechstbetrag > EPS) {
    texte.push(
      `Endgültige Mehrbelastung aus der Gewerbesteuer: ${eurText(erm.nichtAngerechneteGewSt)}. ` +
        `Davon entfallen ${eurText(erm.durchHoechstbetrag)} auf den Ermäßigungshöchstbetrag; ` +
        'dieser Teil ist zugleich im ungenutzten Anrechnungsvolumen enthalten. Beide Posten ' +
        'dürfen deshalb nicht addiert werden.'
    );
  }
  return texte;
}

/**
 * Ermaessigungshoechstbetrag nach § 35 Abs. 1 S. 2 EStG.
 *
 * Die Anrechnung ist auf den Anteil der gewerblichen Einkuenfte an der Summe
 * der Einkuenfte begrenzt. Ohne weitere Einkuenfte betraegt der Quotient 1,
 * sodass der gesamte Betrag zur Verfuegung steht.
 */
function hoechstbetrag35(steuerBasis, gewerblicheEinkuenfte, szenario) {
  const W = sockel(szenario);
  const summeEinkuenfte = gewerblicheEinkuenfte + W;
  const anteil = summeEinkuenfte > 0 ? gewerblicheEinkuenfte / summeEinkuenfte : 0;
  return { betrag: steuerBasis * anteil, anteil };
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
  const W = sockel(szenario);
  const zvE = W + G;
  const estSockel = estTarif(W, szenario.tarifVz);
  const estGesamt = estTarif(zvE, szenario.tarifVz);
  const estTariflich = estGesamt - estSockel;

  const hb = hoechstbetrag35(estGesamt, G, szenario);
  const erm = ermaessigung35(gew.messbetrag, gew.steuer, hb.betrag);

  // Die Quotelung des § 35 Abs. 1 S. 2 EStG stellt sicher, dass die Anrechnung
  // die auf den Gewinn entfallende Steuer nie uebersteigt: wegen der Progression
  // ist ESt(W) <= ESt(W+G) * W/(W+G), also hb <= estGesamt - estSockel.
  const estFestgesetztGesamt = Math.max(0, estGesamt - erm.anrechnung);
  const solzGesamt = solzAufEst(estFestgesetztGesamt, solzOpt);

  const estFestgesetzt = estFestgesetztGesamt - estSockel;
  const solz = solzGesamt - solzAufEst(estSockel, solzOpt);

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
      ...(W > EPS
        ? [posten('weitere Einkünfte (Sockel)', W, '§ 2 Abs. 3 EStG', 'gesellschafter')]
        : []),
      posten('zu versteuerndes Einkommen', zvE, '§ 2 Abs. 5 EStG', 'gesellschafter'),
      posten('tarifliche Einkommensteuer', estTariflich, '§ 32a EStG', 'gesellschafter'),
      posten('Anrechnungsvolumen (4 × Messbetrag)', erm.anrechnungsvolumen, '§ 35 Abs. 1 EStG', 'gesellschafter'),
      posten('Ermäßigungshöchstbetrag', erm.ermaessigungshoechstbetrag, '§ 35 Abs. 1 S. 2 EStG', 'gesellschafter'),
      posten('./. Steuerermäßigung', -erm.anrechnung || 0, '§ 35 Abs. 1 EStG', 'gesellschafter'),
      // Gezahlte Gewerbesteuer, die keine Ermaessigung ausgeloest hat. Oberhalb
      // von 400 % traegt dieser Posten den gesamten Hebesatzeffekt; er kann
      // aber auch unterhalb auftreten, wenn der Hoechstbetrag bindet.
      posten(
        'nicht angerechnete Gewerbesteuer',
        erm.nichtAngerechneteGewSt,
        '§ 35 Abs. 1 EStG',
        'gesellschafter'
      ),
      // Nachrichtlich, weil dieser Posten den vom Hoechstbetrag blockierten
      // Teil mit dem vorstehenden teilt: beide duerfen nicht addiert werden.
      posten(
        'nachrichtlich: ungenutztes Anrechnungsvolumen (verfällt)',
        erm.ueberhang,
        '§ 35 EStG - kein Vor-/Rücktrag',
        'gesellschafter'
      ),
      posten('festzusetzende Einkommensteuer', estFestgesetzt, '§ 2 Abs. 6 EStG', 'gesellschafter'),
      posten('Solidaritätszuschlag', solz, '§ 4 SolZG', 'gesellschafter'),
      posten('Gesamtbelastung der Periode', gesamt, null, 'summe'),
    ],
    hinweise: [
      ...(W > EPS
        ? [
            'Weitere Einkünfte als Sockel: ausgewiesen ist die Steuer, die durch das Hinzutreten ' +
              'des Gewinns entsteht. Der Ermäßigungshöchstbetrag des § 35 EStG ist nach ' +
              `§ 35 Abs. 1 S. 2 EStG auf ${(hb.anteil * 100).toFixed(1).replace('.', ',')} % ` +
              'gekürzt (Anteil der gewerblichen Einkünfte an der Summe der Einkünfte).',
          ]
        : []),
      ...hinweise35(erm),
    ],
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

  // § 34a Abs. 2 EStG in geschlossener Form.
  //
  // Nicht entnommener Gewinn ist der Steuerbilanzgewinn abzueglich des
  // Entnahmesaldos und zuzueglich der Gewerbesteuer (S. 1). Entnahmen zur
  // Zahlung der Thesaurierungssteuer und des darauf entfallenden SolZ bleiben
  // nach S. 2 au§er Ansatz. Bezeichnet E die Steuerentnahme, so gilt
  //
  //   B = [G - (V + entnahmeFrei + GewSt + E)] + GewSt + E
  //     =  G - V - entnahmeFrei
  //
  // GewSt und E kuerzen sich heraus. Die geltende Fassung erzeugt damit keine
  // Zirkularitaet; eine Fixpunktiteration ist entbehrlich.
  const beguenstigungsfaehig = Math.max(0, G - V - entnahmeFrei);
  const B = beguenstigungsfaehig; // voller Antrag
  const regelbesteuert = Math.max(0, G - B);

  // Der regelbesteuerte Gewinnanteil tritt neben die weiteren Einkuenfte; der
  // Sondertarif des § 34a Abs. 1 EStG bleibt davon unberuehrt.
  const W = sockel(szenario);
  const estSockel = estTarif(W, szenario.tarifVz);
  const estGesamtTariflich = estTarif(W + regelbesteuert, szenario.tarifVz);
  const estTariflich = estGesamtTariflich - estSockel;
  const est34a = rs.thesaurierung34a * B;
  const solz34a = solzPauschal(est34a);

  /*
   * Bemessungsgrundlage des Ermaessigungshoechstbetrags (§ 35 Abs. 1 S. 2 EStG).
   *
   * Einbezogen wird die Steuer auf den beguenstigten Gewinn nach § 34a Abs. 1
   * EStG - so die Auffassung der Finanzverwaltung, der die Arbeit folgt. Der
   * beguenstigte Gewinn ist eine gewerbliche Einkunft des Veranlagungszeitraums
   * und im zu versteuernden Einkommen enthalten; § 34a Abs. 1 EStG aendert nur
   * den Steuersatz. Er steht damit im Zaehler und im Nenner des Quotienten des
   * S. 2, sodass die darauf entfallende Steuer dort auch im Multiplikator stehen
   * muss. Die Gegenauffassung ist ueber die Option abschaltbar.
   *
   * Die Nachsteuer des § 34a Abs. 4 EStG bleibt dagegen in BEIDEN Varianten
   * ausser Ansatz, und zwar aus drei Gruenden:
   *   - Wortlaut: § 35 Abs. 1 S. 1 EStG ermaessigt die tarifliche Steuer nur,
   *     "soweit sie anteilig auf im zu versteuernden Einkommen enthaltene
   *     gewerbliche Einkuenfte entfaellt". Der Nachversteuerungsbetrag ist keine
   *     Einkunft und nicht Teil des zvE; § 34a Abs. 4 S. 2 EStG besteuert ihn
   *     mit einem eigenen Satz von 25 %.
   *   - Systematik: er steht deshalb weder in der "Summe der positiven
   *     gewerblichen Einkuenfte" noch in der "Summe aller positiven Einkuenfte"
   *     des S. 2. Eine Steuer in den Multiplikator aufzunehmen, deren
   *     Bemessungsgrundlage in der Quote fehlt, zerstoert die Proportionalitaet,
   *     die die Vorschrift herstellen will. Die Parallele ist die
   *     Abgeltungsteuer: auch sie bleibt aussen vor, und S. 4 nennt mit § 32d
   *     Abs. 6 S. 2 EStG gerade nur den Fall, in dem die Kapitalerkuenfte in das
   *     zvE zurueckkehren.
   *   - Periodenbezug: § 35 Abs. 1 S. 1 Nr. 1 EStG knuepft an den Messbetrag des
   *     dem Veranlagungszeitraum entsprechenden Erhebungszeitraums. Die
   *     Nachsteuer trifft Gewinne frueherer Jahre, deren Messbetraege dort
   *     bereits ihr eigenes Anrechnungsvolumen erzeugt haben. Sie hier
   *     einzubeziehen, oeffnete einen periodenuebergreifenden Transfer, den § 35
   *     EStG mit dem Verbot des Vor- und Ruecktrags gerade ausschliesst.
   * Die Wirkung ist erheblich: bindet der Hoechstbetrag, kippt die Anrechnung
   * vollstaendig (Kontrollfall "Nachsteuer erhoeht den Hoechstbetrag nicht").
   */
  const hbBasis = szenario.optionen.est34aImHoechstbetrag
    ? estGesamtTariflich + est34a
    : estGesamtTariflich;
  const hb = hoechstbetrag35(hbBasis, G, szenario);
  const erm = ermaessigung35(gew.messbetrag, gew.steuer, hb.betrag);

  const estFestgesetztGesamt = Math.max(0, estGesamtTariflich + est34a - erm.anrechnung);
  const solzGesamt = solzAufEst(estFestgesetztGesamt, solzOpt);
  const estFestgesetzt = estFestgesetztGesamt - estSockel;
  const solz = solzGesamt - solzAufEst(estSockel, solzOpt);

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
      posten('Anrechnungsvolumen (4 × Messbetrag)', erm.anrechnungsvolumen, '§ 35 Abs. 1 EStG', 'gesellschafter'),
      posten('Ermäßigungshöchstbetrag', erm.ermaessigungshoechstbetrag, '§ 35 Abs. 1 S. 2 EStG', 'gesellschafter'),
      posten('./. Steuerermäßigung', -erm.anrechnung || 0, '§ 35 Abs. 1 EStG', 'gesellschafter'),
      posten(
        'nicht angerechnete Gewerbesteuer',
        erm.nichtAngerechneteGewSt,
        '§ 35 Abs. 1 EStG',
        'gesellschafter'
      ),
      // Nachrichtlich: teilt den vom Hoechstbetrag blockierten Teil mit dem
      // vorstehenden Posten, darf also nicht hinzuaddiert werden.
      posten(
        'nachrichtlich: ungenutztes Anrechnungsvolumen (verfällt)',
        erm.ueberhang,
        '§ 35 EStG',
        'gesellschafter'
      ),
      posten('festzusetzende Einkommensteuer', estFestgesetzt, '§ 2 Abs. 6 EStG', 'gesellschafter'),
      posten('Solidaritätszuschlag', solz, '§ 4 SolZG', 'gesellschafter'),
      posten('Nachversteuerungsbetrag', nvGesamt, '§ 34a Abs. 4 EStG', 'gesellschafter'),
      posten('Nachversteuerung (25 %) zzgl. SolZ', nvSteuer + solzNv, '§ 34a Abs. 4 EStG', 'gesellschafter'),
      posten('nachversteuerungspflichtiger Betrag (Endbestand)', nvB, '§ 34a Abs. 3 EStG', 'nachrichtlich'),
      posten('Gesamtbelastung der Periode', gesamt, null, 'summe'),
    ],
    hinweise: [
      'Begünstigungsfähiger Gewinn geschlossen ermittelt: die nach § 34a Abs. 2 S. 2 EStG außer Ansatz bleibende Steuerentnahme und die Hinzurechnung der Gewerbesteuer heben sich auf.',
      ...(W > EPS
        ? [
            'Weitere Einkünfte als Sockel: sie heben den Tarif auf dem regelbesteuerten ' +
              'Gewinnanteil, lassen den Sondertarif des § 34a Abs. 1 EStG aber unberührt. ' +
              `Ermäßigungshöchstbetrag nach § 35 Abs. 1 S. 2 EStG auf ${(hb.anteil * 100)
                .toFixed(1)
                .replace('.', ',')} % gekürzt.`,
          ]
        : []),
      ...hinweise35(erm),
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

/**
 * Besteuerung von Gehalt und Ausschuettung beim Gesellschafter.
 *
 * Grundfall ist der gesonderte Tarif des § 32d Abs. 1 EStG: 25 % zzgl. SolZ,
 * abgeltend erhoben und vom uebrigen zvE isoliert. Daneben bildet das Modell
 * die beiden Wahlrechte ab, die diesen Tarif verdraengen:
 *
 *   § 32d Abs. 2 Nr. 3 EStG  Teileinkuenfteverfahren. Auf Antrag gehen 60 % der
 *                            Ausschuettung in das zvE ein (§ 3 Nr. 40 Buchst. d
 *                            EStG), 40 % bleiben steuerfrei. Voraussetzung ist
 *                            eine Beteiligung von mindestens 25 % oder von
 *                            mindestens 1 % bei beruflicher Taetigkeit fuer die
 *                            Gesellschaft; beides ist unter den Modellannahmen
 *                            erfuellt (Alleingesellschafter-Geschaeftsfuehrer).
 *   § 32d Abs. 6 EStG        Guenstigerpruefung. Die Kapitalertraege werden in
 *                            voller Hoehe dem zvE hinzugerechnet, wenn das zu
 *                            einer niedrigeren Steuer fuehrt; andernfalls
 *                            bleibt es beim gesonderten Tarif.
 *
 * Beide verlagern die Besteuerung in die Veranlagung. Der SolZ folgt dann
 * § 4 SolZG mit Freigrenze und Milderungszone statt der pauschalen Erhebung
 * auf die Kapitalertragsteuer.
 *
 * Das Teileinkuenfteverfahren hat Vorrang: § 32d Abs. 6 EStG erfasst nur
 * Kapitalertraege, die dem gesonderten Tarif des Abs. 1 unterliegen.
 */
function gesellschaftersteuer(gehalt, ausschuettung, szenario, solzOpt) {
  const tarifVz = szenario.tarifVz;
  const V = Math.max(0, gehalt);
  const A = Math.max(0, ausschuettung);

  // Weitere Einkuenfte als Sockel: ihre eigene Steuer bleibt aussen vor.
  const W = sockel(szenario);
  const estSockel = estTarif(W, tarifVz);
  const solzSockel = solzAufEst(estSockel, solzOpt);

  const estGehalt = estTarif(W + V, tarifVz) - estSockel;
  const solzGehalt = solzAufEst(estTarif(W + V, tarifVz), solzOpt) - solzSockel;

  // Grundfall: gesonderter Tarif.
  const kapEst = KONSTANTEN.abgeltungsteuerSatz * A;
  const solzKap = solzPauschal(kapEst);
  const abgeltung = {
    regime: 'abgeltung',
    est: estGehalt,
    abgeltungsteuer: kapEst,
    solz: solzGehalt + solzKap,
    summe: estGehalt + solzGehalt + kapEst + solzKap,
    posten: [
      ...(W > EPS ? [posten('weitere Einkünfte (Sockel)', W, '§ 2 Abs. 3 EStG', 'gesellschafter')] : []),
      posten('zu versteuerndes Einkommen (ohne Ausschüttung)', W + V, '§ 2 Abs. 5 EStG', 'gesellschafter'),
      posten('Einkommensteuer auf Gehalt', estGehalt, '§ 19, § 32a EStG', 'gesellschafter'),
      posten('SolZ auf Gehalt', solzGehalt, '§ 4 SolZG', 'gesellschafter'),
      posten('Abgeltungsteuer (25 %)', kapEst, '§ 32d Abs. 1 EStG', 'gesellschafter'),
      posten('SolZ auf Abgeltungsteuer', solzKap, '§ 4 SolZG', 'gesellschafter'),
    ],
    hinweise: [],
  };

  // Veranlagung der Ausschuettung zum Tarif, wahlweise nur zu 60 %.
  const veranlagt = (anteil, norm) => {
    const steuerpflichtig = anteil * A;
    const steuerfrei = A - steuerpflichtig;
    const zvE = W + V + steuerpflichtig;
    const estGesamt = estTarif(zvE, tarifVz);
    const solzGesamt = solzAufEst(estGesamt, solzOpt);
    const est = estGesamt - estSockel;
    const solz = solzGesamt - solzSockel;
    return {
      est,
      abgeltungsteuer: 0,
      solz,
      summe: est + solz,
      posten: [
        ...(W > EPS ? [posten('weitere Einkünfte (Sockel)', W, '§ 2 Abs. 3 EStG', 'gesellschafter')] : []),
        posten('Arbeitslohn', V, '§ 19 EStG', 'gesellschafter'),
        posten('Einkünfte aus Kapitalvermögen', A, '§ 20 Abs. 1 Nr. 1 EStG', 'gesellschafter'),
        ...(steuerfrei > EPS
          ? [posten('./. steuerfreier Teil (40 %)', -steuerfrei, '§ 3 Nr. 40 Buchst. d EStG', 'gesellschafter')]
          : []),
        posten('zu versteuerndes Einkommen', zvE, '§ 2 Abs. 5 EStG', 'gesellschafter'),
        posten('tarifliche Einkommensteuer', est, norm, 'gesellschafter'),
        posten('Solidaritätszuschlag', solz, '§ 4 SolZG', 'gesellschafter'),
      ],
    };
  };

  if (szenario.optionen.teileinkuenfte) {
    const tev = veranlagt(KONSTANTEN.teileinkuenfteAnteil, '§ 32a EStG');
    const differenz = tev.summe - abgeltung.summe;
    return {
      ...tev,
      regime: 'teileinkuenfte',
      vergleichAbgeltung: abgeltung.summe,
      hinweise: [
        'Teileinkünfteverfahren beantragt (§ 32d Abs. 2 Nr. 3 EStG): 40 % der Ausschüttung ' +
          'bleiben nach § 3 Nr. 40 Buchst. d EStG steuerfrei, der Rest unterliegt dem Tarif. ' +
          'Der gesonderte Tarif des § 32d Abs. 1 EStG ist damit ausgeschlossen.' +
          (Math.abs(differenz) > 1
            ? ` Gegenüber der Abgeltungsteuer ${differenz > 0 ? 'höher' : 'niedriger'} um ` +
              `${Math.abs(differenz).toFixed(0)} EUR.`
            : ''),
      ],
    };
  }

  if (szenario.optionen.guenstigerpruefung) {
    // § 32d Abs. 6 EStG: Einbeziehung in voller Hoehe, aber nur, wenn guenstiger.
    const tarif = veranlagt(1, '§ 32a EStG');
    if (tarif.summe < abgeltung.summe - EPS) {
      return {
        ...tarif,
        regime: 'guenstiger-tarif',
        vergleichAbgeltung: abgeltung.summe,
        hinweise: [
          'Günstigerprüfung (§ 32d Abs. 6 EStG) fällt zugunsten des Tarifs aus: Einbeziehung ' +
            `in das zvE spart ${(abgeltung.summe - tarif.summe).toFixed(0)} EUR gegenüber dem ` +
            'gesonderten Tarif.',
        ],
      };
    }
    return {
      ...abgeltung,
      regime: 'guenstiger-abgeltung',
      vergleichTarif: tarif.summe,
      hinweise: [
        'Günstigerprüfung (§ 32d Abs. 6 EStG) durchgeführt, bleibt ohne Wirkung: die Veranlagung ' +
          `zum Tarif ergäbe ${(tarif.summe - abgeltung.summe).toFixed(0)} EUR mehr. Es bleibt beim ` +
          'gesonderten Tarif des § 32d Abs. 1 EStG.',
      ],
    };
  }

  return abgeltung;
}

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

  // Gesellschafterebene: gesonderter Tarif oder eines der beiden Wahlrechte.
  const gs = gesellschaftersteuer(V, ausschuettung, szenario, solzOpt);

  const gesamt = gew.steuer + kst + solzKst + gs.summe;

  return {
    vz,
    hebesatz: hs,
    gesamt,
    komponenten: {
      gewerbesteuer: gew.steuer,
      koerperschaftsteuer: kst,
      einkommensteuer: gs.est,
      abgeltungsteuer: gs.abgeltungsteuer,
      solz: solzKst + gs.solz,
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
      ...gs.posten,
      posten('Gesamtbelastung der Periode', gesamt, null, 'summe'),
    ],
    hinweise: [
      ...(fiktion && !istSchluss
        ? ['Ausschüttungsfiktion § 1a Abs. 3 S. 5 KStG: Thesaurierung ausgeschlossen.']
        : []),
      ...(istSchluss && szenario.optionen.schlussausschuettung
        ? ['Schlussperiode: Ausschüttung des gesamten thesaurierten Vermögens.']
        : []),
      ...gs.hinweise,
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
