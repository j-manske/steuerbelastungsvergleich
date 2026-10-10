import {
  berechne,
  sensitivitaet,
  VARIANTEN,
  STANDARD_SZENARIO,
  STANDARD_OPTIONEN,
  KNICK_HEBESATZ,
} from '../core/model.js';
import { rechtsstandTabelle, REFERENZ_TARIF_VZ } from '../core/rates.js';
import { linienDiagramm, saeulenDiagramm, legende } from './chart.js';
import { eur, eurExakt, eurKompakt, prozent, ganz, csvZahl } from './format.js';

const $ = (id) => document.getElementById(id);

/** Standarddauer aus dem Basisszenario der Arbeit (2026-2032). */
const STANDARD_DAUER = STANDARD_SZENARIO.bisVz - STANDARD_SZENARIO.vonVz + 1;

/**
 * Hebesatzspanne der Sensitivitaetsanalyse nach Abschnitt 2.3 der Arbeit:
 * von der gesetzlichen Untergrenze des § 16 Abs. 4 S. 2 GewStG bis zum oberen
 * Rand des Bereichs, in dem sich die weit ueberwiegende Zahl der Gemeinden bewegt.
 */
const SENS_VON = 280;
const SENS_BIS = 600;

/**
 * Voreinstellung des Vergleichshebesatzes. 500 % liegt deutlich oberhalb des
 * Knickpunkts des § 35 EStG und damit in dem Bereich, in dem die
 * Personengesellschaften ihren Vorteil wieder verlieren - der Vergleich zeigt
 * den Effekt also schon ohne weitere Eingabe.
 */
const VERGLEICH_VORGABE = 500;

const felder = {
  hebesatz: $('hebesatz'),
  hebesatzZahl: $('hebesatz-zahl'),
  optVergleich: $('opt-vergleich'),
  hebesatzB: $('hebesatz-b'),
  hebesatzBZahl: $('hebesatz-b-zahl'),
  gewinn: $('gewinn'),
  verguetung: $('verguetung'),
  weitere: $('weitere'),
  // Die Oberflaeche fragt die Entnahme-/Ausschuettungsquote ab (Abschnitt 2.4
  // der Arbeit); der Kern rechnet weiterhin mit der Gegengroesse.
  entnahme: $('entnahme'),
  entnahmeZahl: $('entnahme-zahl'),
  zins: $('zins'),
  vonVz: $('von-vz'),
  dauer: $('dauer'),
  optSchluss: $('opt-schluss'),
  optMindest: $('opt-mindest'),
  optSolz: $('opt-solz'),
  optHoechst: $('opt-hoechst'),
  optFiktion: $('opt-fiktion'),
  optTev: $('opt-tev'),
  optGuenstiger: $('opt-guenstiger'),
  optKontrolle: $('opt-kontrolle'),
};

let sensMass = 'barwert';
let letztesErgebnis = null;
/** Ergebnis des Vergleichshebesatzes oder null, wenn der Vergleich aus ist. */
let letzterVergleich = null;

/**
 * Hebesatz der Vergleichsgemeinde oder null, wenn der Vergleich abgeschaltet
 * ist. Der zweite Hebesatz aendert nur den Hebesatz, nicht die uebrigen
 * Annahmen; verglichen werden also zwei Gemeinden bei sonst gleichem Szenario.
 */
function leseVergleichHebesatz() {
  if (!felder.optVergleich.checked) return null;
  const v = Number.parseFloat(felder.hebesatzBZahl.value);
  return Number.isFinite(v) ? Math.max(0, v) : null;
}

/** Betragsdifferenz mit explizitem Vorzeichen; "±0 €" bei Gleichstand. */
const deltaEur = (v) => (Math.abs(v) < 0.5 ? '±0 €' : `${v > 0 ? '+' : '−'}${eur(Math.abs(v))}`);

/**
 * Rang einer Ausprägung mit Gleichstand. Der Kern vergibt auch bei
 * betragsgleichen Barwerten verschiedene Raenge; GmbH und optierende
 * Gesellschaft verlaufen aber unter vielen Annahmen deckungsgleich. Fuer den
 * Hebesatzvergleich wuerde das einen Rangwechsel vortaeuschen, der nur aus der
 * Sortierreihenfolge stammt. Gleichstaende erhalten deshalb denselben Rang.
 */
function rang(ergebnis, key) {
  const eigen = ergebnis.varianten[key].barwert;
  return 1 + VARIANTEN.filter((v) => ergebnis.varianten[v.key].barwert < eigen - 1).length;
}

/** Differenz in Prozentpunkten mit explizitem Vorzeichen. */
const deltaPp = (v) =>
  Math.abs(v) < 0.00005
    ? '±0,00 pp'
    : `${v > 0 ? '+' : '−'}${prozent(Math.abs(v)).replace(' %', '')} pp`;

function leseSzenario() {
  const zahl = (feld, fallback) => {
    const v = Number.parseFloat(feld.value);
    return Number.isFinite(v) ? v : fallback;
  };
  const vonVz = Math.round(zahl(felder.vonVz, 2026));
  // Die Dauer ist die Eingabegroesse; der letzte VZ wird daraus abgeleitet.
  const dauer = Math.min(30, Math.max(1, Math.round(zahl(felder.dauer, STANDARD_DAUER))));
  const bisVz = vonVz + dauer - 1;

  return {
    gewinn: Math.max(0, zahl(felder.gewinn, STANDARD_SZENARIO.gewinn)),
    verguetung: Math.max(0, zahl(felder.verguetung, STANDARD_SZENARIO.verguetung)),
    // Sockelbetrag: bestimmt nur den Grenzsteuersatz, die auf ihn entfallende
    // Steuer bleibt ausserhalb des Vergleichsmassstabs.
    weitereEinkuenfte: Math.max(0, zahl(felder.weitere, STANDARD_SZENARIO.weitereEinkuenfte)),
    thesaurierungsquote:
      1 -
      Math.min(
        1,
        Math.max(0, zahl(felder.entnahmeZahl, (1 - STANDARD_SZENARIO.thesaurierungsquote) * 100) / 100)
      ),
    hebesatz: Math.max(0, zahl(felder.hebesatzZahl, STANDARD_SZENARIO.hebesatz)),
    kalkulationszins: Math.max(0, zahl(felder.zins, STANDARD_SZENARIO.kalkulationszins * 100) / 100),
    vonVz,
    bisVz,
    tarifVz: REFERENZ_TARIF_VZ,
    optionen: {
      schlussausschuettung: felder.optSchluss.checked,
      mindesthebesatzErzwingen: felder.optMindest.checked,
      solzFreigrenze: felder.optSolz.checked,
      est34aImHoechstbetrag: felder.optHoechst.checked,
      ausschuettungsfiktion1a: felder.optFiktion.checked,
      teileinkuenfte: felder.optTev.checked,
      // Bei beantragtem Teileinkuenfteverfahren ist der gesonderte Tarif
      // ausgeschlossen; § 32d Abs. 6 EStG laeuft dann leer.
      guenstigerpruefung: felder.optGuenstiger.checked && !felder.optTev.checked,
    },
  };
}

/**
 * Die Guenstigerpruefung setzt voraus, dass die Ausschuettung ueberhaupt dem
 * gesonderten Tarif unterliegt. Wird das Teileinkuenfteverfahren beantragt,
 * ist der Schalter daher gesperrt.
 */
function aktualisiereWahlrechte() {
  const tev = felder.optTev.checked;
  felder.optGuenstiger.disabled = tev;
  $('schalter-guenstiger').classList.toggle('gesperrt', tev);
  $('hinweis-wahlrechte').hidden = !tev;
}

/* ---------------- Ergebniskarten ---------------- */

function zeichneVarianten(ergebnis, kontrolle) {
  const raster = $('varianten-raster');
  raster.innerHTML = '';
  for (const v of VARIANTEN) {
    const d = ergebnis.varianten[v.key];
    const k = kontrolle?.varianten[v.key];
    const div = document.createElement('div');
    div.className = 'variante' + (d.rang === 1 ? ' beste' : '');
    div.style.setProperty('--farbe', v.farbe);
    const deltaText =
      d.abstandZumBesten < 1
        ? '<span class="delta null">günstigste Ausprägung</span>'
        : `<span class="delta plus">+ ${eur(d.abstandZumBesten)} ggü. Rang 1</span>`;
    div.innerHTML = `
      <div class="rang">Rang ${d.rang}</div>
      <div class="name">${v.label}</div>
      <div class="wert">${eur(d.barwert)}</div>
      <div class="zusatz">effektiv ${prozent(d.effektiv)} &middot; nominal ${eur(d.nominal)}</div>
      ${deltaText}
      ${k ? `<div class="zusatz">ohne Vergütung: ${eur(k.barwert)} (${prozent(k.effektiv)})</div>` : ''}
    `;
    raster.appendChild(div);
  }

  const s = ergebnis.szenario;
  // Die Wahlrechte des § 32d EStG aendern die Ausschuettungsbesteuerung
  // grundlegend und werden deshalb im Kopf ausgewiesen.
  const wahlrecht = s.optionen.teileinkuenfte
    ? ' · Teileinkünfteverfahren'
    : s.optionen.guenstigerpruefung
      ? ' · Günstigerprüfung'
      : '';
  // Ein Sockelbetrag verschiebt den Grenzsteuersatz und damit alle Ergebnisse;
  // er gehoert deshalb sichtbar in den Kopf.
  const sockel = s.weitereEinkuenfte > 0 ? ` · weitere Einkünfte ${ganz(s.weitereEinkuenfte)} EUR` : '';
  $('zeitraum-badge').textContent =
    `VZ ${s.vonVz}–${s.bisVz} · Hebesatz ${ganz(s.hebesatz)} % · Entnahmequote ${ganz(
      (1 - s.thesaurierungsquote) * 100
    )} % · i = ${ganz(s.kalkulationszins * 100)} %${sockel}${wahlrecht}`;
}

/* ---------------- Diagramme ---------------- */

function zeichneSensitivitaet(szenario, vergleich = null) {
  // Untersuchungsbereich nach Abschnitt 2.3. Liegt einer der markierten
  // Hebesaetze ausserhalb, wird die Spanne erweitert, damit beide Markierungen
  // und der Knickpunkt des § 35 EStG sichtbar bleiben.
  const markiert = [szenario.hebesatz, KNICK_HEBESATZ];
  if (vergleich) markiert.push(vergleich.szenario.hebesatz);
  const von = Math.min(SENS_VON, ...markiert.map((h) => Math.floor(h / 5) * 5));
  const bis = Math.max(SENS_BIS, ...markiert.map((h) => Math.ceil(h / 5) * 5));
  const { punkte, schnittpunkte } = sensitivitaet(szenario, { von, bis, schritt: 5 });
  const daten = punkte.map((p) => ({
    x: p.hebesatz,
    werte: Object.fromEntries(VARIANTEN.map((v) => [v.key, p.werte[v.key][sensMass]])),
  }));
  const reihen = VARIANTEN.map((v) => ({ ...v, label: v.kurz }));
  const eng = ($('chart-sensitivitaet').clientWidth || 760) < 420;

  const name = (k) => VARIANTEN.find((v) => v.key === k).kurz;
  const identisch = Math.abs(punkte[0].werte.gmbh.barwert - punkte[0].werte.optierend.barwert) < 1;

  // Verlaufen GmbH und optierende Gesellschaft deckungsgleich, waere jeder
  // Rangwechsel doppelt aufgefuehrt; die Optionspaare entfallen dann.
  const relevant = schnittpunkte.filter(
    (s) =>
      s.hebesatz >= von &&
      s.hebesatz <= bis &&
      !(identisch && (s.a === 'optierend' || s.b === 'optierend'))
  );

  // Alle Schnittstellen je Paar sammeln. Zwei Schnittpunkte bedeuten einen
  // Vorteilskorridor, nicht einen einzelnen Rangwechsel (Abschnitt 3.3).
  const paare = new Map();
  for (const s of relevant) {
    const key = `${s.a}|${s.b}`;
    if (!paare.has(key)) paare.set(key, { a: s.a, b: s.b, stellen: [] });
    paare.get(key).stellen.push(s.hebesatz);
  }

  const wertBei = (key, h) => {
    const p = punkte.reduce((best, k) =>
      Math.abs(k.hebesatz - h) < Math.abs(best.hebesatz - h) ? k : best
    );
    return p.werte[key][sensMass];
  };

  // Korridor der insgesamt guenstigsten Personengesellschaftsvariante
  // gegenueber der GmbH schattieren. Nur dieser eine Korridor, weil mehrere
  // ueberlagerte Flaechen das Diagramm unlesbar machen.
  const zonen = [];
  const korridorPaar = [...paare.values()].find(
    (p) => p.stellen.length === 2 && (p.a === 'gmbh' || p.b === 'gmbh')
  );
  if (korridorPaar) {
    const stellen = korridorPaar.stellen.slice().sort((x, y) => x - y);
    const mitte = (stellen[0] + stellen[1]) / 2;
    const gewinner =
      wertBei(korridorPaar.a, mitte) < wertBei(korridorPaar.b, mitte)
        ? korridorPaar.a
        : korridorPaar.b;
    zonen.push({
      von: stellen[0],
      bis: stellen[1],
      label: `${name(gewinner)} günstiger`,
    });
  }

  // Knickpunkt des § 35 EStG und - falls aktiv - der Vergleichshebesatz.
  const markierungen = [
    { x: KNICK_HEBESATZ, label: `${ganz(KNICK_HEBESATZ)} % (§ 35)`, klasse: 'marker-knick' },
  ];
  if (vergleich) {
    markierungen.push({
      x: vergleich.szenario.hebesatz,
      label: `${ganz(vergleich.szenario.hebesatz)} %`,
      klasse: 'marker-zweit',
    });
  }

  const punktMarken = relevant.map((s) => ({
    x: s.hebesatz,
    y: wertBei(s.a, s.hebesatz),
    titel: `Rangwechsel ${name(s.a)} / ${name(s.b)} bei rund ${Math.round(s.hebesatz)} %`,
  }));

  linienDiagramm($('chart-sensitivitaet'), daten, reihen, {
    hoehe: 380,
    xLabel: 'Gewerbesteuerhebesatz in %',
    yLabel: eng ? '' : sensMass === 'barwert' ? 'Barwert der Gesamtsteuerbelastung' : 'Effektive Steuerbelastung',
    formatX: (v) => `${Math.round(v)} %`,
    formatY: sensMass === 'barwert' ? (v) => eur(v) : (v) => prozent(v, 1),
    formatAchse: sensMass === 'barwert' ? (v) => eurKompakt(v) : (v) => prozent(v, 0),
    marker: szenario.hebesatz,
    markerLabel: `${ganz(szenario.hebesatz)} %`,
    zonen,
    markierungen,
    punktMarken,
  });
  legende($('legende-sensitivitaet'), VARIANTEN.map((v) => ({ ...v, label: v.label })));

  const texte = [...paare.values()].map(({ a, b, stellen }) => {
    stellen.sort((x, y) => x - y);
    if (stellen.length === 2) {
      const mitte = (stellen[0] + stellen[1]) / 2;
      const guenstiger = wertBei(a, mitte) < wertBei(b, mitte) ? a : b;
      const andere = guenstiger === a ? b : a;
      return (
        `<b>${name(guenstiger)}</b> ist gegenüber <b>${name(andere)}</b> nur zwischen rund ` +
        `${Math.round(stellen[0])} % und ${Math.round(stellen[1])} % günstiger`
      );
    }
    return (
      `<b>${name(a)} / ${name(b)}</b> bei rund ` +
      stellen.map((h) => `${Math.round(h)} %`).join(' und ')
    );
  });

  const deckungsgleich = identisch
    ? ' GmbH und optierende Gesellschaft verlaufen unter den eingestellten Annahmen deckungsgleich; die Optionskurve ist deshalb gestrichelt dargestellt.'
    : '';

  // Die Legende der Markierungen gehoert in den Text, weil das Diagramm selbst
  // nur die Zahlenwerte an den Linien ausweist.
  const legendeMarker =
    ` Die durchgezogene senkrechte Linie markiert den eingestellten Hebesatz${
      vergleich ? ', die gestrichelte den Vergleichshebesatz' : ''
    }; die gepunktete Linie bei ${ganz(KNICK_HEBESATZ)} % ist der Knickpunkt des § 35 EStG.` +
    (zonen.length ? ` Der hinterlegte Bereich ist das Vorteilsfenster, die Punkte sind die Rangwechsel.` : '');

  $('schnittpunkte').innerHTML =
    (texte.length
      ? `Rangwechsel im untersuchten Bereich: ${texte.join('; ')}.`
      : 'Im untersuchten Bereich schneiden sich die Belastungskurven nicht; die Rangfolge bleibt vom Hebesatz unberührt.') +
    legendeMarker +
    deckungsgleich;
}

/* ---------------- Hebesatzvergleich ---------------- */

/**
 * Stellt zwei Hebesaetze gegenueber. Verglichen wird dasselbe Szenario allein
 * mit geaendertem Hebesatz, sodass die Differenz ausschliesslich der Gemeinde
 * zuzurechnen ist.
 *
 * Der Hebesatzeffekt ist je Ausprägung strukturell verschieden: bei der
 * Kapitalgesellschaft steigt die Belastung linear mit dem Hebesatz, bei den
 * Personengesellschaften bleibt sie bis 400 % nahezu konstant, weil die
 * Anrechnung des § 35 EStG die Gewerbesteuer aufzehrt, und steigt erst
 * darueber. Zwei Stuetzstellen koennen diesen Knick verdecken; die Tabelle
 * weist deshalb zusaetzlich die mittlere Steigung je 100 Hebesatzpunkte aus.
 */
function zeichneVergleich(ergebnis, vergleich) {
  $('karte-vergleich').hidden = !vergleich;
  if (!vergleich) return;

  const hA = ergebnis.szenario.hebesatz;
  const hB = vergleich.szenario.hebesatz;
  const spanne = (hB - hA) / 100;

  const kopf = `<thead><tr><th>Größe</th>${VARIANTEN.map(
    (v) => `<th>${v.kurz}</th>`
  ).join('')}</tr></thead>`;

  const zeile = (label, zellen, klasse = '') =>
    `<tr${klasse ? ` class="${klasse}"` : ''}><td>${label}</td>${zellen.join('')}</tr>`;

  const je = (fn) => VARIANTEN.map((v) => `<td>${fn(ergebnis.varianten[v.key], vergleich.varianten[v.key])}</td>`);

  /**
   * Differenzzelle. Eine Mehrbelastung wird rot ausgezeichnet - hier bedeutet
   * ein positives Vorzeichen also, anders als bei den Posten des Schemas, die
   * schlechtere Lage.
   */
  const jeDelta = (wert, text) =>
    VARIANTEN.map((v) => {
      const d = wert(ergebnis.varianten[v.key], vergleich.varianten[v.key]);
      const klasse = Math.abs(d) < 1e-9 ? 'null-wert' : d > 0 ? 'negativ' : '';
      return `<td class="${klasse}">${text(d)}</td>`;
    });

  const zeilen = [
    zeile(`Barwert bei ${ganz(hA)} %`, je((a) => eur(a.barwert))),
    zeile(`Barwert bei ${ganz(hB)} %`, je((a, b) => eur(b.barwert))),
    zeile(
      'Differenz in EUR',
      jeDelta((a, b) => b.barwert - a.barwert, deltaEur),
      'summenzeile'
    ),
    zeile(`Effektive Belastung bei ${ganz(hA)} %`, je((a) => prozent(a.effektiv))),
    zeile(`Effektive Belastung bei ${ganz(hB)} %`, je((a, b) => prozent(b.effektiv))),
    zeile(
      'Differenz in Prozentpunkten',
      jeDelta((a, b) => b.effektiv - a.effektiv, deltaPp),
      'summenzeile'
    ),
    // Die mittlere Steigung macht die unterschiedliche Hebesatzempfindlichkeit
    // unmittelbar vergleichbar; sie ist nur ausserhalb des Knicks konstant.
    zeile(
      'je 100 Hebesatzpunkte',
      je((a, b) => (Math.abs(spanne) < 1e-9 ? '–' : deltaPp((b.effektiv - a.effektiv) / spanne)))
    ),
    zeile(
      'Rangfolge',
      VARIANTEN.map((v) => {
        const rA = rang(ergebnis, v.key);
        const rB = rang(vergleich, v.key);
        return `<td>${rA === rB ? `${rA}` : `<b>${rA} → ${rB}</b>`}</td>`;
      })
    ),
  ];

  $('vergleich-tabelle').innerHTML = `${kopf}<tbody>${zeilen.join('')}</tbody>`;

  const besteA = VARIANTEN.filter((v) => rang(ergebnis, v.key) === 1);
  const besteB = VARIANTEN.filter((v) => rang(vergleich, v.key) === 1);
  const wechsel = VARIANTEN.filter((v) => rang(ergebnis, v.key) !== rang(vergleich, v.key));

  const liste = (vs) => vs.map((v) => v.label).join(' und ');
  const gleicheSpitze =
    besteA.length === besteB.length && besteA.every((v) => besteB.some((w) => w.key === v.key));

  const teile = [];
  if (Math.abs(hB - hA) < 1e-9) {
    teile.push('Beide Hebesätze sind gleich; die Differenzen sind daher null.');
  } else if (!gleicheSpitze) {
    teile.push(
      `<b>Rangfolgenwechsel:</b> bei ${ganz(hA)} % ist ${liste(besteA)} günstigste Ausprägung, ` +
        `bei ${ganz(hB)} % dagegen ${liste(besteB)}. Die Rechtsformwahl kippt also allein durch den Hebesatz.`
    );
  } else if (wechsel.length) {
    teile.push(
      `Die günstigste Ausprägung bleibt ${liste(besteA)}; die Rangfolge der übrigen verschiebt sich jedoch ` +
        `(${wechsel.map((v) => `${v.kurz} ${rang(ergebnis, v.key)} → ${rang(vergleich, v.key)}`).join(', ')}).`
    );
  } else {
    teile.push(
      `Die Rangfolge ist in beiden Gemeinden identisch; ${liste(besteA)} bleibt günstigste Ausprägung.`
    );
  }

  // Unterhalb des Mindesthebesatzes rechnet der Kern mit dem angehobenen Wert;
  // die Spaltenueberschriften zeigen dagegen die Eingabe. Ohne Hinweis waere
  // die ausgewiesene Differenz nicht nachvollziehbar.
  const angehoben = [hA, hB].filter((h) => ergebnis.szenario.optionen.mindesthebesatzErzwingen && h < 280);
  if (angehoben.length) {
    teile.push(
      `Für ${angehoben.map((h) => `${ganz(h)} %`).join(' und ')} greift ab EZ 2027 der Mindesthebesatz ` +
        'von 280 % (§ 16 Abs. 4 S. 2 GewStG); gerechnet wird für diese Perioden mit 280 %, die Differenz ' +
        'fällt entsprechend geringer aus als die Eingabe vermuten lässt.'
    );
  }

  // Der Knick des § 35 EStG liegt genau bei 400 %. Liegt er zwischen den
  // beiden Stuetzstellen, ist die ausgewiesene mittlere Steigung ein Mischwert.
  if ((hA - KNICK_HEBESATZ) * (hB - KNICK_HEBESATZ) < 0) {
    teile.push(
      `Der Knickpunkt des § 35 EStG bei ${ganz(KNICK_HEBESATZ)} % liegt zwischen den beiden Hebesätzen. ` +
        'Die Steigung je 100 Punkte ist für die Personengesellschaften deshalb ein Mischwert aus dem ' +
        'flachen Verlauf unterhalb und dem steilen oberhalb der Grenze; das Diagramm zeigt den Bruch.'
    );
  }

  $('vergleich-hinweis').innerHTML = teile.join(' ');
}

function zeichnePerioden(ergebnis) {
  const kategorien = ergebnis.varianten.persG.perioden.map((p, i) => ({
    label: String(p.vz),
    werte: Object.fromEntries(VARIANTEN.map((v) => [v.key, ergebnis.varianten[v.key].perioden[i].gesamt])),
  }));
  saeulenDiagramm($('chart-perioden'), kategorien, VARIANTEN.map((v) => ({ ...v, label: v.kurz })), {
    hoehe: 300,
    formatY: (v) => eur(v),
    formatAchse: (v) => eurKompakt(v),
  });
  legende($('legende-perioden'), VARIANTEN.map((v) => ({ ...v, label: v.label })));
}

/* ---------------- Tabellen ---------------- */

function zeichnePeriodenTabelle(ergebnis) {
  const perioden = ergebnis.varianten.persG.perioden;
  const kopf = `<thead><tr><th>VZ</th><th>Hebesatz</th>${VARIANTEN.map(
    (v) => `<th>${v.kurz}</th>`
  ).join('')}<th>Diskontfaktor</th></tr></thead>`;

  const zeilen = perioden
    .map((p, i) => {
      const zellen = VARIANTEN.map((v) => {
        const per = ergebnis.varianten[v.key].perioden[i];
        return `<td>${eur(per.gesamt)}</td>`;
      }).join('');
      const angehoben = p.hebesatz.angehoben
        ? ` <span title="gesetzlicher Mindesthebesatz">↑</span>`
        : '';
      return `<tr><td>${p.vz}</td><td>${ganz(p.hebesatz.hebesatz)} %${angehoben}</td>${zellen}<td>${p.diskontfaktor.toFixed(
        4
      ).replace('.', ',')}</td></tr>`;
    })
    .join('');

  const nominal = `<tr class="summenzeile"><td>Summe nominal</td><td></td>${VARIANTEN.map(
    (v) => `<td>${eur(ergebnis.varianten[v.key].nominal)}</td>`
  ).join('')}<td></td></tr>`;
  const barwert = `<tr class="summenzeile"><td>Barwert</td><td></td>${VARIANTEN.map(
    (v) => `<td>${eur(ergebnis.varianten[v.key].barwert)}</td>`
  ).join('')}<td></td></tr>`;
  const stundung = `<tr class="summenzeile"><td>Stundungseffekt (nominal ./. Barwert)</td><td></td>${VARIANTEN.map(
    (v) => `<td>${eur(ergebnis.varianten[v.key].stundungseffekt)}</td>`
  ).join('')}<td></td></tr>`;
  const effektiv = `<tr class="summenzeile"><td>Effektive Belastung (Barwert)</td><td></td>${VARIANTEN.map(
    (v) => `<td>${prozent(ergebnis.varianten[v.key].effektiv)}</td>`
  ).join('')}<td></td></tr>`;

  $('perioden-tabelle').innerHTML = `${kopf}<tbody>${zeilen}${nominal}${barwert}${stundung}${effektiv}</tbody>`;
}

/**
 * Vergleichsschluessel einer Postenbeschriftung. Einzelne Posten fuehren den
 * Hebesatz in der Beschriftung mit ("Gewerbesteuer (Hebesatz 400 %)"); beim
 * Nebeneinanderstellen zweier Hebesaetze wuerden sich die Zeilen dann nicht
 * entsprechen - und zwar gerade bei dem Posten, auf den es hier ankommt.
 */
const postenSchluessel = (label) => label.replace(/\(Hebesatz[^)]*\)/, '(Hebesatz)');

const EBENEN_LABEL = {
  nachrichtlich: 'Ausgangsgrößen',
  gesellschaft: 'Gesellschaftsebene',
  gesellschafter: 'Gesellschafterebene',
  summe: 'Ergebnis',
};

function zeichneDetail(ergebnis, vergleich = null) {
  const varianteKey = $('detail-variante').value;
  const periodeIdx = Number.parseInt($('detail-periode').value, 10) || 0;
  const variante = ergebnis.varianten[varianteKey];
  if (!variante) return;
  const periode = variante.perioden[periodeIdx] ?? variante.perioden[0];

  // Bei aktivem Hebesatzvergleich werden beide Ermittlungsschemata
  // nebeneinandergestellt. Die Postenfolge einer Ausprägung ist fest, sodass
  // sich die Zeilen Position fuer Position entsprechen; zur Sicherheit wird
  // die Beschriftung abgeglichen.
  const vPeriode = vergleich
    ? (vergleich.varianten[varianteKey].perioden[periodeIdx] ??
      vergleich.varianten[varianteKey].perioden[0])
    : null;
  const spalten = vPeriode ? 5 : 3;

  const kopf = vPeriode
    ? `<thead><tr><th>Position</th><th>${ganz(ergebnis.szenario.hebesatz)} %</th><th>${ganz(
        vergleich.szenario.hebesatz
      )} %</th><th>Differenz</th><th class="norm">Norm</th></tr></thead>`
    : '<thead><tr><th>Position</th><th>Betrag</th><th class="norm">Norm</th></tr></thead>';

  let html = `${kopf}<tbody>`;
  let letzteEbene = null;
  periode.posten.forEach((p, i) => {
    if (p.ebene !== letzteEbene) {
      html += `<tr class="ebene"><td colspan="${spalten}">${EBENEN_LABEL[p.ebene] ?? p.ebene}</td></tr>`;
      letzteEbene = p.ebene;
    }
    const klassen = [];
    if (p.betrag < -0.005) klassen.push('negativ');
    if (Math.abs(p.betrag) < 0.005) klassen.push('null-wert');
    // Im Vergleich traegt die Spaltenueberschrift den Hebesatz; in der
    // Beschriftung waere er irrefuehrend, weil dort zwei Werte stehen.
    const label = vPeriode ? p.label.replace(/\s*\(Hebesatz[^)]*\)/, '') : p.label;
    html += `<tr${p.ebene === 'summe' ? ' class="summenzeile"' : ''}><td>${label}</td><td class="${klassen.join(
      ' '
    )}">${eurExakt(p.betrag)}</td>`;
    if (vPeriode) {
      const q = vPeriode.posten[i];
      const passt = q && postenSchluessel(q.label) === postenSchluessel(p.label);
      const d = passt ? q.betrag - p.betrag : 0;
      html += `<td class="${passt && Math.abs(q.betrag) < 0.005 ? 'null-wert' : ''}">${
        passt ? eurExakt(q.betrag) : '–'
      }</td><td class="${Math.abs(d) < 0.005 ? 'null-wert' : ''}">${passt ? deltaEur(d) : '–'}</td>`;
    }
    html += `<td class="norm">${p.norm ?? ''}</td></tr>`;
  });
  html += '</tbody>';
  $('detail-tabelle').innerHTML = html;

  const hinweise = $('detail-hinweise');
  // Hinweise, die nur bei einem der beiden Hebesaetze auftreten, werden
  // gekennzeichnet - sie sind gerade der interessante Teil des Vergleichs.
  const eintraege = periode.hinweise.map((h) => `<li>${h}</li>`);
  if (vPeriode) {
    for (const h of vPeriode.hinweise) {
      if (!periode.hinweise.includes(h)) {
        eintraege.push(`<li><em>nur bei ${ganz(vergleich.szenario.hebesatz)} %:</em> ${h}</li>`);
      }
    }
  }
  hinweise.innerHTML = eintraege.join('');
}

function fuelleDetailAuswahl(ergebnis) {
  const vSelect = $('detail-variante');
  const alterWert = vSelect.value;
  vSelect.innerHTML = VARIANTEN.map((v) => `<option value="${v.key}">${v.kurz}</option>`).join('');
  if (alterWert) vSelect.value = alterWert;

  const pSelect = $('detail-periode');
  const alterIdx = pSelect.value;
  const perioden = ergebnis.varianten.persG.perioden;
  pSelect.innerHTML = perioden.map((p, i) => `<option value="${i}">VZ ${p.vz}</option>`).join('');
  if (alterIdx !== '' && Number(alterIdx) < perioden.length) pSelect.value = alterIdx;
}

function zeichneRechtsstand(ergebnis) {
  const s = ergebnis.szenario;
  const zeilen = rechtsstandTabelle(s.vonVz, s.bisVz)
    .map((r, i) => {
      const h = ergebnis.hebesaetze[i];
      return `<tr><td>${r.vz}${r.fortgeschrieben ? ' *' : ''}</td><td>${ganz(r.kst * 100)} %</td><td>${(
        r.thesaurierung34a * 100
      )
        .toFixed(2)
        .replace('.', ',')} %</td><td>${ganz(r.gewstMindesthebesatz)} %</td><td>${ganz(
        h.hebesatz
      )} %${h.angehoben ? ' ↑' : ''}</td></tr>`;
    })
    .join('');
  $('rechtsstand-tabelle').innerHTML = `<thead><tr><th>VZ</th><th>KSt § 23 KStG</th><th>§ 34a EStG</th><th>Mindesthebesatz</th><th>angewandter Hebesatz</th></tr></thead><tbody>${zeilen}</tbody>`;
}

/* ---------------- CSV ---------------- */

function csvExport() {
  if (!letztesErgebnis) return;
  const e = letztesErgebnis;
  const s = e.szenario;
  const zeilen = [];
  zeilen.push('Steuerbelastungsvergleich der Rechtsformen');
  zeilen.push('');
  zeilen.push('Parameter;Wert');
  zeilen.push(`Gewinn vor Steuern;${csvZahl(s.gewinn)}`);
  zeilen.push(`Taetigkeitsverguetung;${csvZahl(s.verguetung)}`);
  zeilen.push(`Weitere Einkuenfte (Sockel);${csvZahl(s.weitereEinkuenfte)}`);
  zeilen.push(`Entnahme-/Ausschuettungsquote;${csvZahl((1 - s.thesaurierungsquote) * 100)}`);
  zeilen.push(`Hebesatz;${csvZahl(s.hebesatz)}`);
  zeilen.push(`Kalkulationszins;${csvZahl(s.kalkulationszins * 100)}`);
  zeilen.push(`Zeitraum;${s.vonVz}-${s.bisVz}`);
  zeilen.push(
    `Ausschuettungsbesteuerung;${
      s.optionen.teileinkuenfte
        ? 'Teileinkuenfteverfahren (§ 32d Abs. 2 Nr. 3 EStG)'
        : s.optionen.guenstigerpruefung
          ? 'Guenstigerpruefung (§ 32d Abs. 6 EStG)'
          : 'Abgeltungsteuer (§ 32d Abs. 1 EStG)'
    }`
  );
  zeilen.push('');
  zeilen.push(['VZ', ...VARIANTEN.map((v) => v.kurz)].join(';'));
  e.varianten.persG.perioden.forEach((p, i) => {
    zeilen.push([p.vz, ...VARIANTEN.map((v) => csvZahl(e.varianten[v.key].perioden[i].gesamt))].join(';'));
  });
  zeilen.push(['Summe nominal', ...VARIANTEN.map((v) => csvZahl(e.varianten[v.key].nominal))].join(';'));
  zeilen.push(['Barwert', ...VARIANTEN.map((v) => csvZahl(e.varianten[v.key].barwert))].join(';'));
  zeilen.push(
    ['Effektive Belastung in %', ...VARIANTEN.map((v) => csvZahl(e.varianten[v.key].effektiv * 100))].join(';')
  );

  // Hebesatzvergleich nur exportieren, wenn er auch angezeigt wird.
  if (letzterVergleich) {
    const hB = letzterVergleich.szenario.hebesatz;
    zeilen.push('');
    zeilen.push(`Hebesatzvergleich;${csvZahl(s.hebesatz)};gegen;${csvZahl(hB)}`);
    zeilen.push(['Groesse', ...VARIANTEN.map((v) => v.kurz)].join(';'));
    zeilen.push(
      [`Barwert bei ${Math.round(s.hebesatz)} %`, ...VARIANTEN.map((v) => csvZahl(e.varianten[v.key].barwert))].join(';')
    );
    zeilen.push(
      [
        `Barwert bei ${Math.round(hB)} %`,
        ...VARIANTEN.map((v) => csvZahl(letzterVergleich.varianten[v.key].barwert)),
      ].join(';')
    );
    zeilen.push(
      [
        'Differenz in EUR',
        ...VARIANTEN.map((v) => csvZahl(letzterVergleich.varianten[v.key].barwert - e.varianten[v.key].barwert)),
      ].join(';')
    );
    zeilen.push(
      [
        'Differenz in Prozentpunkten',
        ...VARIANTEN.map((v) =>
          csvZahl((letzterVergleich.varianten[v.key].effektiv - e.varianten[v.key].effektiv) * 100)
        ),
      ].join(';')
    );
    zeilen.push(
      [
        'Rang vorher/nachher',
        // Dieselbe Rangbildung wie in der Tabelle: Gleichstaende teilen sich
        // einen Rang, damit die Sortierreihenfolge keinen Wechsel vortaeuscht.
        ...VARIANTEN.map((v) => `${rang(e, v.key)}/${rang(letzterVergleich, v.key)}`),
      ].join(';')
    );
  }

  const blob = new Blob(['﻿' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `steuerbelastungsvergleich_${s.vonVz}-${s.bisVz}_h${Math.round(s.hebesatz)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Steuerung ---------------- */

function aktualisiereHebesatzHinweis(szenario) {
  const angehoben = szenario.optionen.mindesthebesatzErzwingen && szenario.hebesatz < 280;
  const el = $('hebesatz-hinweis');
  if (angehoben) {
    el.className = 'hinweis warnung';
    el.textContent = `Ab EZ 2027 gilt der Mindesthebesatz von 280 % (§ 16 Abs. 4 S. 2 GewStG); für diese Perioden wird 280 % angesetzt.`;
  } else {
    el.className = 'hinweis';
    el.textContent =
      'Das Vierfache des Messbetrags nach § 35 EStG entspricht rechnerisch einem Hebesatz von 400 %. Unterhalb verfällt Anrechnungsvolumen mangels dahinterstehender Gewerbesteuer, weil der Abzug auf die gezahlte Gewerbesteuer begrenzt ist (§ 35 Abs. 1 S. 5 EStG); oberhalb bleibt die überschießende Gewerbesteuer endgültige Belastung. Der Ermäßigungshöchstbetrag (§ 35 Abs. 1 S. 2 EStG) wirkt daneben und hebesatzunabhängig: bindet er, bleibt auch unterhalb von 400 % Gewerbesteuer endgültig. Der gewogene Bundesdurchschnitt liegt bei rund 400 % und fällt damit nahezu mit dieser Grenze zusammen.';
  }
}

/** Zeigt den abgeleiteten Zeitraum und weist auf fortgeschriebenen Rechtsstand hin. */
function aktualisiereZeitraumHinweis(szenario) {
  const dauer = szenario.bisVz - szenario.vonVz + 1;
  const zeilen = rechtsstandTabelle(szenario.vonVz, szenario.bisVz);
  const fortgeschrieben = zeilen.filter((z) => z.fortgeschrieben).map((z) => z.vz);
  const el = $('zeitraum-hinweis');
  const basis = `Zeitraum ${szenario.vonVz}–${szenario.bisVz} (${dauer} ${
    dauer === 1 ? 'Periode' : 'Perioden'
  }).`;
  $('untertitel-zeitraum').textContent =
    dauer === 1
      ? `Einperiodiges Modell ${szenario.vonVz}`
      : `Mehrperiodiges Modell ${szenario.vonVz}–${szenario.bisVz}`;
  if (fortgeschrieben.length) {
    el.className = 'hinweis warnung';
    el.textContent = `${basis} Für ${
      fortgeschrieben.length === 1
        ? `VZ ${fortgeschrieben[0]}`
        : `die VZ ${fortgeschrieben[0]}–${fortgeschrieben[fortgeschrieben.length - 1]}`
    } liegt kein verabschiedeter Rechtsstand vor; es wird der letzte bekannte Stand fortgeschrieben.`;
  } else {
    el.className = 'hinweis';
    el.textContent = `${basis} Der Rechtsstand ist für den gesamten Zeitraum verabschiedet.`;
  }

  for (const btn of $('dauer-schnellwahl').querySelectorAll('button')) {
    btn.classList.toggle('aktiv', Number(btn.dataset.dauer) === dauer);
  }
}

function rechne() {
  const szenario = leseSzenario();
  const ergebnis = berechne(szenario);
  letztesErgebnis = ergebnis;

  // Zweiter Hebesatz bei sonst unveraendertem Szenario.
  const hebesatzB = leseVergleichHebesatz();
  const vergleich = hebesatzB === null ? null : berechne({ ...szenario, hebesatz: hebesatzB });
  letzterVergleich = vergleich;

  const kontrolle = felder.optKontrolle.checked ? berechne({ ...szenario, verguetung: 0 }) : null;
  $('kontroll-hinweis').hidden = !kontrolle;
  if (kontrolle) {
    $('kontroll-hinweis').textContent =
      'Kontrollrechnung: identisches Szenario ohne Tätigkeitsvergütung. Die Differenz zeigt den Einfluss der Vergütung, die bei GmbH und optierender Gesellschaft die Bemessungsgrundlage mindert, bei der Personengesellschaft dagegen über § 15 Abs. 1 S. 1 Nr. 2 EStG in den Gewerbeertrag eingeht.';
  }

  aktualisiereHebesatzHinweis(ergebnis.szenario);
  aktualisiereZeitraumHinweis(ergebnis.szenario);
  zeichneVarianten(ergebnis, kontrolle);
  zeichneSensitivitaet(szenario, vergleich);
  zeichneVergleich(ergebnis, vergleich);
  zeichnePerioden(ergebnis);
  zeichnePeriodenTabelle(ergebnis);
  fuelleDetailAuswahl(ergebnis);
  zeichneDetail(ergebnis, vergleich);
  zeichneRechtsstand(ergebnis);
}

/** Blendet die Eingabe des zweiten Hebesatzes und die Vergleichskarte ein. */
function aktualisiereVergleich() {
  $('vergleich-zeile').hidden = !felder.optVergleich.checked;
  rechne();
}

function koppleSlider(slider, zahl) {
  slider.addEventListener('input', () => {
    zahl.value = slider.value;
    rechne();
  });
  zahl.addEventListener('input', () => {
    const v = Number.parseFloat(zahl.value);
    if (Number.isFinite(v)) slider.value = String(v);
    rechne();
  });
}

function setzeZurueck() {
  const s = STANDARD_SZENARIO;
  felder.gewinn.value = s.gewinn;
  felder.verguetung.value = s.verguetung;
  felder.weitere.value = s.weitereEinkuenfte;
  felder.hebesatz.value = s.hebesatz;
  felder.hebesatzZahl.value = s.hebesatz;
  felder.optVergleich.checked = false;
  felder.hebesatzB.value = VERGLEICH_VORGABE;
  felder.hebesatzBZahl.value = VERGLEICH_VORGABE;
  $('vergleich-zeile').hidden = true;
  const entnahme = (1 - s.thesaurierungsquote) * 100;
  felder.entnahme.value = entnahme;
  felder.entnahmeZahl.value = entnahme;
  felder.zins.value = s.kalkulationszins * 100;
  felder.vonVz.value = s.vonVz;
  felder.dauer.value = STANDARD_DAUER;
  // Die Modellvarianten werden aus den Standardoptionen des Kerns abgeleitet,
  // damit Oberflaeche und Berechnungskern nicht auseinanderlaufen koennen.
  felder.optSchluss.checked = STANDARD_OPTIONEN.schlussausschuettung;
  felder.optMindest.checked = STANDARD_OPTIONEN.mindesthebesatzErzwingen;
  felder.optSolz.checked = STANDARD_OPTIONEN.solzFreigrenze;
  felder.optHoechst.checked = STANDARD_OPTIONEN.est34aImHoechstbetrag;
  felder.optFiktion.checked = STANDARD_OPTIONEN.ausschuettungsfiktion1a;
  felder.optTev.checked = STANDARD_OPTIONEN.teileinkuenfte;
  felder.optGuenstiger.checked = STANDARD_OPTIONEN.guenstigerpruefung;
  felder.optKontrolle.checked = false;
  aktualisiereWahlrechte();
  rechne();
}

koppleSlider(felder.hebesatz, felder.hebesatzZahl);
koppleSlider(felder.hebesatzB, felder.hebesatzBZahl);
koppleSlider(felder.entnahme, felder.entnahmeZahl);
[
  felder.gewinn,
  felder.verguetung,
  felder.weitere,
  felder.zins,
  felder.vonVz,
  felder.dauer,
  felder.optSchluss,
  felder.optMindest,
  felder.optSolz,
  felder.optHoechst,
  felder.optFiktion,
  felder.optTev,
  felder.optGuenstiger,
  felder.optKontrolle,
].forEach((f) => f.addEventListener('input', rechne));

felder.optTev.addEventListener('input', aktualisiereWahlrechte);
aktualisiereWahlrechte();

felder.optVergleich.addEventListener('input', aktualisiereVergleich);
$('vergleich-zeile').hidden = !felder.optVergleich.checked;

$('dauer-schnellwahl').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-dauer]');
  if (!btn) return;
  felder.dauer.value = btn.dataset.dauer;
  rechne();
});

$('detail-variante').addEventListener('change', () => zeichneDetail(letztesErgebnis, letzterVergleich));
$('detail-periode').addEventListener('change', () => zeichneDetail(letztesErgebnis, letzterVergleich));

document.querySelectorAll('.segment').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.segment').forEach((b) => b.classList.remove('aktiv'));
    btn.classList.add('aktiv');
    sensMass = btn.dataset.mass;
    zeichneSensitivitaet(leseSzenario(), letzterVergleich);
  });
});

$('btn-methodik').addEventListener('click', () => $('methodik').showModal());
$('btn-reset').addEventListener('click', setzeZurueck);
$('btn-csv').addEventListener('click', csvExport);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (letztesErgebnis) {
      zeichneSensitivitaet(letztesErgebnis.szenario, letzterVergleich);
      zeichnePerioden(letztesErgebnis);
    }
  }, 150);
});

rechne();
