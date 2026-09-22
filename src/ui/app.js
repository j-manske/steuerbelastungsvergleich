import {
  berechne,
  sensitivitaet,
  VARIANTEN,
  STANDARD_SZENARIO,
  STANDARD_OPTIONEN,
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

const felder = {
  hebesatz: $('hebesatz'),
  hebesatzZahl: $('hebesatz-zahl'),
  gewinn: $('gewinn'),
  verguetung: $('verguetung'),
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
  optKontrolle: $('opt-kontrolle'),
};

let sensMass = 'barwert';
let letztesErgebnis = null;

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
    gewinn: Math.max(0, zahl(felder.gewinn, 300000)),
    verguetung: Math.max(0, zahl(felder.verguetung, STANDARD_SZENARIO.verguetung)),
    thesaurierungsquote:
      1 - Math.min(1, Math.max(0, zahl(felder.entnahmeZahl, 0) / 100)),
    hebesatz: Math.max(0, zahl(felder.hebesatzZahl, 400)),
    kalkulationszins: Math.max(0, zahl(felder.zins, 3) / 100),
    vonVz,
    bisVz,
    tarifVz: REFERENZ_TARIF_VZ,
    optionen: {
      schlussausschuettung: felder.optSchluss.checked,
      mindesthebesatzErzwingen: felder.optMindest.checked,
      solzFreigrenze: felder.optSolz.checked,
      est34aImHoechstbetrag: felder.optHoechst.checked,
      ausschuettungsfiktion1a: felder.optFiktion.checked,
    },
  };
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
  $('zeitraum-badge').textContent =
    `VZ ${s.vonVz}–${s.bisVz} · Hebesatz ${ganz(s.hebesatz)} % · Entnahmequote ${ganz(
      (1 - s.thesaurierungsquote) * 100
    )} % · i = ${ganz(s.kalkulationszins * 100)} %`;
}

/* ---------------- Diagramme ---------------- */

function zeichneSensitivitaet(szenario) {
  // Untersuchungsbereich nach Abschnitt 2.3. Liegt der eingestellte Hebesatz
  // ausserhalb, wird die Spanne erweitert, damit die Markierung sichtbar bleibt.
  const von = Math.min(SENS_VON, Math.floor(szenario.hebesatz / 5) * 5);
  const bis = Math.max(SENS_BIS, Math.ceil(szenario.hebesatz / 5) * 5);
  const { punkte, schnittpunkte } = sensitivitaet(szenario, { von, bis, schritt: 5 });
  const daten = punkte.map((p) => ({
    x: p.hebesatz,
    werte: Object.fromEntries(VARIANTEN.map((v) => [v.key, p.werte[v.key][sensMass]])),
  }));
  const reihen = VARIANTEN.map((v) => ({ ...v, label: v.kurz }));
  const eng = ($('chart-sensitivitaet').clientWidth || 760) < 420;

  linienDiagramm($('chart-sensitivitaet'), daten, reihen, {
    hoehe: 380,
    xLabel: 'Gewerbesteuerhebesatz in %',
    yLabel: eng ? '' : sensMass === 'barwert' ? 'Barwert der Gesamtsteuerbelastung' : 'Effektive Steuerbelastung',
    formatX: (v) => `${Math.round(v)} %`,
    formatY: sensMass === 'barwert' ? (v) => eur(v) : (v) => prozent(v, 1),
    formatAchse: sensMass === 'barwert' ? (v) => eurKompakt(v) : (v) => prozent(v, 0),
    marker: szenario.hebesatz,
    markerLabel: `${ganz(szenario.hebesatz)} %`,
  });
  legende($('legende-sensitivitaet'), VARIANTEN.map((v) => ({ ...v, label: v.label })));

  const relevant = schnittpunkte.filter((s) => s.hebesatz >= von && s.hebesatz <= bis);
  const einmalig = [];
  for (const s of relevant) {
    const key = `${s.a}|${s.b}`;
    if (!einmalig.some((e) => e.key === key)) einmalig.push({ key, ...s });
  }
  const name = (k) => VARIANTEN.find((v) => v.key === k).kurz;
  const deckungsgleich =
    Math.abs(punkte[0].werte.gmbh.barwert - punkte[0].werte.optierend.barwert) < 1
      ? ' GmbH und optierende Gesellschaft verlaufen unter den eingestellten Annahmen deckungsgleich; die Optionskurve ist deshalb gestrichelt dargestellt.'
      : '';
  $('schnittpunkte').innerHTML =
    (einmalig.length
      ? `Rangwechsel im untersuchten Bereich: ${einmalig
          .map((s) => `<b>${name(s.a)} / ${name(s.b)}</b> bei rund ${Math.round(s.hebesatz)} %`)
          .join(', ')}. Die senkrechte Linie markiert den eingestellten Hebesatz.`
      : 'Im untersuchten Bereich schneiden sich die Belastungskurven nicht; die Rangfolge bleibt vom Hebesatz unberührt.') +
    deckungsgleich;
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

const EBENEN_LABEL = {
  nachrichtlich: 'Ausgangsgrößen',
  gesellschaft: 'Gesellschaftsebene',
  gesellschafter: 'Gesellschafterebene',
  summe: 'Ergebnis',
};

function zeichneDetail(ergebnis) {
  const varianteKey = $('detail-variante').value;
  const periodeIdx = Number.parseInt($('detail-periode').value, 10) || 0;
  const variante = ergebnis.varianten[varianteKey];
  if (!variante) return;
  const periode = variante.perioden[periodeIdx] ?? variante.perioden[0];

  let html = '<thead><tr><th>Position</th><th>Betrag</th><th class="norm">Norm</th></tr></thead><tbody>';
  let letzteEbene = null;
  for (const p of periode.posten) {
    if (p.ebene !== letzteEbene) {
      html += `<tr class="ebene"><td colspan="3">${EBENEN_LABEL[p.ebene] ?? p.ebene}</td></tr>`;
      letzteEbene = p.ebene;
    }
    const klassen = [];
    if (p.betrag < -0.005) klassen.push('negativ');
    if (Math.abs(p.betrag) < 0.005) klassen.push('null-wert');
    html += `<tr${p.ebene === 'summe' ? ' class="summenzeile"' : ''}><td>${p.label}</td><td class="${klassen.join(
      ' '
    )}">${eurExakt(p.betrag)}</td><td class="norm">${p.norm ?? ''}</td></tr>`;
  }
  html += '</tbody>';
  $('detail-tabelle').innerHTML = html;

  const hinweise = $('detail-hinweise');
  hinweise.innerHTML = periode.hinweise.map((h) => `<li>${h}</li>`).join('');
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
  zeilen.push(`Entnahme-/Ausschuettungsquote;${csvZahl((1 - s.thesaurierungsquote) * 100)}`);
  zeilen.push(`Hebesatz;${csvZahl(s.hebesatz)}`);
  zeilen.push(`Kalkulationszins;${csvZahl(s.kalkulationszins * 100)}`);
  zeilen.push(`Zeitraum;${s.vonVz}-${s.bisVz}`);
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
      'Das Vierfache des Messbetrags nach § 35 EStG entspricht rechnerisch einem Hebesatz von 400 %; oberhalb entsteht bei Personengesellschaften ein Anrechnungsüberhang. Der gewogene Bundesdurchschnitt liegt bei rund 400 % und fällt damit nahezu mit dieser Grenze zusammen.';
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

  const kontrolle = felder.optKontrolle.checked ? berechne({ ...szenario, verguetung: 0 }) : null;
  $('kontroll-hinweis').hidden = !kontrolle;
  if (kontrolle) {
    $('kontroll-hinweis').textContent =
      'Kontrollrechnung: identisches Szenario ohne Tätigkeitsvergütung. Die Differenz zeigt den Einfluss der Vergütung, die bei GmbH und optierender Gesellschaft die Bemessungsgrundlage mindert, bei der Personengesellschaft dagegen über § 15 Abs. 1 S. 1 Nr. 2 EStG in den Gewerbeertrag eingeht.';
  }

  aktualisiereHebesatzHinweis(ergebnis.szenario);
  aktualisiereZeitraumHinweis(ergebnis.szenario);
  zeichneVarianten(ergebnis, kontrolle);
  zeichneSensitivitaet(szenario);
  zeichnePerioden(ergebnis);
  zeichnePeriodenTabelle(ergebnis);
  fuelleDetailAuswahl(ergebnis);
  zeichneDetail(ergebnis);
  zeichneRechtsstand(ergebnis);
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
  felder.hebesatz.value = s.hebesatz;
  felder.hebesatzZahl.value = s.hebesatz;
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
  felder.optKontrolle.checked = false;
  rechne();
}

koppleSlider(felder.hebesatz, felder.hebesatzZahl);
koppleSlider(felder.entnahme, felder.entnahmeZahl);
[
  felder.gewinn,
  felder.verguetung,
  felder.zins,
  felder.vonVz,
  felder.dauer,
  felder.optSchluss,
  felder.optMindest,
  felder.optSolz,
  felder.optHoechst,
  felder.optFiktion,
  felder.optKontrolle,
].forEach((f) => f.addEventListener('input', rechne));

$('dauer-schnellwahl').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-dauer]');
  if (!btn) return;
  felder.dauer.value = btn.dataset.dauer;
  rechne();
});

$('detail-variante').addEventListener('change', () => zeichneDetail(letztesErgebnis));
$('detail-periode').addEventListener('change', () => zeichneDetail(letztesErgebnis));

document.querySelectorAll('.segment').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.segment').forEach((b) => b.classList.remove('aktiv'));
    btn.classList.add('aktiv');
    sensMass = btn.dataset.mass;
    zeichneSensitivitaet(leseSzenario());
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
      zeichneSensitivitaet(letztesErgebnis.szenario);
      zeichnePerioden(letztesErgebnis);
    }
  }, 150);
});

rechne();
