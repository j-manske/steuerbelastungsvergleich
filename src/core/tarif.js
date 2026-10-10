/**
 * Einkommensteuertarif (§ 32a EStG), Solidaritaetszuschlag und Gewerbesteuer.
 * Zustandsfreie Funktionen ohne Kenntnis der Rechtsform.
 */

import { EST_TARIFE, REFERENZ_TARIF_VZ, KONSTANTEN } from './rates.js';

export function abrunden(betrag, schritt) {
  return Math.floor(betrag / schritt) * schritt;
}

/**
 * Tarifliche Einkommensteuer nach § 32a Abs. 1 EStG.
 * Das zvE wird auf volle Euro abgerundet, die Steuer ebenso (§ 32a Abs. 1 S. 5).
 */
export function estTarif(zvE, tarifVz = REFERENZ_TARIF_VZ) {
  const tarif = EST_TARIFE[tarifVz] ?? EST_TARIFE[REFERENZ_TARIF_VZ];
  const x = Math.max(0, Math.floor(zvE));
  for (const zone of tarif.zonen) {
    if (x > zone.bis) continue;
    if (zone.typ === 'null') return 0;
    if (zone.typ === 'progression') {
      const y = (x - zone.basis) / 10000;
      return Math.floor((zone.a * y + zone.b) * y + zone.c);
    }
    return Math.floor(zone.satz * x - zone.abzug);
  }
  return 0;
}

/** Grenzsteuersatz des § 32a EStG, numerisch genaehert. */
export function grenzsteuersatz(zvE, tarifVz = REFERENZ_TARIF_VZ) {
  const d = 100;
  return (estTarif(zvE + d, tarifVz) - estTarif(zvE, tarifVz)) / d;
}

/**
 * Solidaritaetszuschlag, § 4 SolZG mit Freigrenze und Milderungszone
 * (§ 3 Abs. 3 bis 5 SolZG). Bemessungsgrundlage ist die festgesetzte
 * Einkommensteuer.
 */
export function solzAufEst(bemessungsgrundlage, { freigrenze = true, tarifVz = REFERENZ_TARIF_VZ } = {}) {
  const bmg = Math.max(0, bemessungsgrundlage);
  const voll = KONSTANTEN.solzSatz * bmg;
  if (!freigrenze) return voll;
  const tarif = EST_TARIFE[tarifVz] ?? EST_TARIFE[REFERENZ_TARIF_VZ];
  if (bmg <= tarif.solzFreigrenze) return 0;
  const milderung = tarif.solzMilderungssatz * (bmg - tarif.solzFreigrenze);
  return Math.min(voll, milderung);
}

/** SolZ ohne Freigrenze - gilt fuer Koerperschaftsteuer und Kapitalertragsteuer. */
export function solzPauschal(bemessungsgrundlage) {
  return KONSTANTEN.solzSatz * Math.max(0, bemessungsgrundlage);
}

/**
 * Gewerbesteuer nach §§ 6, 7, 11, 16 GewStG.
 *
 *   GewSt = ( abgerundeter Gewerbeertrag - Freibetrag ) * 3,5 % * Hebesatz
 *
 * Hinzurechnungen (§ 8 GewStG) und Kuerzungen (§ 9 GewStG) bleiben ausser
 * Betracht; der Gewerbeertrag entspricht dem Gewinn vor Steuern
 * (Abschnitt 2.1.1 der Arbeit).
 */
export function gewerbesteuer(gewerbeertrag, freibetrag, hebesatzProzent) {
  const roh = Math.max(0, gewerbeertrag);
  const abgerundet = abrunden(roh, 100);
  const nachFreibetrag = Math.max(0, abgerundet - freibetrag);
  const messbetrag = nachFreibetrag * KONSTANTEN.gewstMesszahl;
  const steuer = messbetrag * (hebesatzProzent / 100);
  return {
    gewerbeertrag: roh,
    abgerundet,
    freibetrag,
    bemessungsgrundlage: nachFreibetrag,
    messbetrag,
    hebesatz: hebesatzProzent,
    steuer,
  };
}

/**
 * Steuerermaessigung nach § 35 EStG: das Vierfache des Messbetrags
 * (§ 35 Abs. 1 S. 1 Nr. 1 EStG), begrenzt auf den Ermaessigungshoechstbetrag
 * (§ 35 Abs. 1 S. 2 EStG) und auf die tatsaechlich zu zahlende Gewerbesteuer
 * (§ 35 Abs. 1 S. 5 EStG). Ueberhaenge sind weder vor- noch ruecktragbar.
 *
 * Die beiden hebesatzabhaengigen Grenzen wirken in entgegengesetzten Bereichen:
 *   - unter 400 % ist das Anrechnungsvolumen groesser als die gezahlte
 *     Gewerbesteuer, es bindet also S. 5 und ein Teil des Volumens verfaellt;
 *   - ab 400 % ist die gezahlte Gewerbesteuer groesser als das Volumen, die
 *     ueber 4 x Messbetrag hinausgehende Gewerbesteuer bleibt endgueltig.
 * Der Umschlagpunkt liegt wegen 4 x 3,5 % = 14 % stets bei genau 400 %,
 * unabhaengig von Gewinn und Freibetrag.
 *
 * Der Ermaessigungshoechstbetrag des S. 2 ist davon unabhaengig und kann in
 * BEIDEN Bereichen zusaetzlich binden - etwa wenn die Steuer nach § 34a Abs. 1
 * EStG nicht in den Hoechstbetrag einbezogen wird. Die Ursachen schliessen
 * einander deshalb nicht aus; die Funktion weist sie einzeln aus.
 */
export function ermaessigung35(messbetrag, gezahlteGewSt, ermaessigungshoechstbetrag) {
  const volumen = KONSTANTEN.anrechnungsfaktor35 * messbetrag;
  const hoechst = Math.max(0, ermaessigungshoechstbetrag);
  const nachGewSt = Math.min(volumen, gezahlteGewSt);
  const anrechnung = Math.max(0, Math.min(nachGewSt, hoechst));

  // Drei disjunkte Ursachen dafuer, dass Anrechnungsvolumen oder gezahlte
  // Gewerbesteuer ohne Wirkung bleiben.
  /** Volumen ohne dahinterstehende Gewerbesteuer - nur unterhalb von 400 %. */
  const ohneGewSt = Math.max(0, volumen - gezahlteGewSt);
  /** Gewerbesteuer ueber 4 x Messbetrag - nur oberhalb von 400 %. */
  const ueberVolumen = Math.max(0, gezahlteGewSt - volumen);
  /** Vom Hoechstbetrag blockierter Teil - hebesatzunabhaengig. */
  const durchHoechstbetrag = Math.max(0, nachGewSt - anrechnung);

  const ursachen = [];
  if (ohneGewSt > 1e-9) {
    ursachen.push('Begrenzung auf die gezahlte Gewerbesteuer, Hebesatz unter 400 % (§ 35 Abs. 1 S. 5 EStG)');
  }
  if (ueberVolumen > 1e-9) {
    ursachen.push('Gewerbesteuer über 4 × Messbetrag, Hebesatz über 400 % (§ 35 Abs. 1 S. 1 Nr. 1 EStG)');
  }
  if (durchHoechstbetrag > 1e-9) {
    ursachen.push('Ermäßigungshöchstbetrag (§ 35 Abs. 1 S. 2 EStG)');
  }

  return {
    anrechnungsvolumen: volumen,
    begrenztAufGewSt: nachGewSt,
    ermaessigungshoechstbetrag,
    anrechnung,
    /**
     * Ungenutztes Anrechnungsvolumen (4 x Messbetrag ./. Anrechnung);
     * identisch mit ohneGewSt + durchHoechstbetrag.
     */
    ueberhang: ohneGewSt + durchHoechstbetrag,
    /**
     * Gezahlte Gewerbesteuer, die keine Ermaessigung ausgeloest hat und damit
     * endgueltige Belastung bleibt; identisch mit ueberVolumen +
     * durchHoechstbetrag.
     *
     * ACHTUNG: ueberhang und nichtAngerechneteGewSt sind NICHT disjunkt. Sie
     * teilen sich den Summanden durchHoechstbetrag und duerfen deshalb nicht
     * addiert werden.
     */
    nichtAngerechneteGewSt: ueberVolumen + durchHoechstbetrag,
    ohneGewSt,
    ueberVolumen,
    durchHoechstbetrag,
    ursachen,
    ueberhangUrsache: ursachen.length ? ursachen.join('; ') : null,
  };
}
