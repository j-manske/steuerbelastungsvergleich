/** Minimale SVG-Diagramme ohne externe Abhaengigkeiten. */

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function nettesRaster(min, max, ziel = 6) {
  const spanne = max - min || 1;
  const roh = spanne / ziel;
  const mag = Math.pow(10, Math.floor(Math.log10(roh)));
  const norm = roh / mag;
  const schritt = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / schritt) * schritt;
  const ende = Math.ceil(max / schritt) * schritt;
  const ticks = [];
  for (let v = start; v <= ende + schritt * 1e-9; v += schritt) ticks.push(v);
  return { ticks, start, ende };
}

/**
 * Liniendiagramm.
 * @param {{x:number, werte:Record<string,number>}[]} punkte
 * @param {{key:string,label:string,farbe:string}[]} reihen
 */
export function linienDiagramm(container, punkte, reihen, optionen = {}) {
  const {
    breite = container.clientWidth || 760,
    hoehe = 380,
    xLabel = '',
    yLabel = '',
    formatY = (v) => String(Math.round(v)),
    formatX = (v) => String(v),
    marker = null,
    markerLabel = '',
  } = optionen;
  const formatAchse = optionen.formatAchse ?? formatY;

  container.innerHTML = '';
  if (!punkte.length) return;

  const pad = { top: 16, right: 20, bottom: 46, left: yLabel ? 96 : 76 };
  const w = breite - pad.left - pad.right;
  const h = hoehe - pad.top - pad.bottom;

  const xs = punkte.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of punkte)
    for (const r of reihen) {
      const v = p.werte[r.key];
      if (Number.isFinite(v)) {
        yMin = Math.min(yMin, v);
        yMax = Math.max(yMax, v);
      }
    }
  const puffer = (yMax - yMin) * 0.08 || 1;
  const raster = nettesRaster(yMin - puffer, yMax + puffer);

  const sx = (x) => pad.left + ((x - xMin) / (xMax - xMin || 1)) * w;
  const sy = (y) => pad.top + h - ((y - raster.start) / (raster.ende - raster.start || 1)) * h;

  const svg = el('svg', {
    viewBox: `0 0 ${breite} ${hoehe}`,
    width: '100%',
    height: hoehe,
    role: 'img',
    class: 'chart',
  });

  for (const t of raster.ticks) {
    svg.appendChild(el('line', { x1: pad.left, x2: pad.left + w, y1: sy(t), y2: sy(t), class: 'grid' }));
    svg.appendChild(
      el('text', { x: pad.left - 10, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, formatAchse(t))
    );
  }

  for (const x of nettesRaster(xMin, xMax, 8).ticks) {
    if (x < xMin - 1e-9 || x > xMax + 1e-9) continue;
    svg.appendChild(el('line', { x1: sx(x), x2: sx(x), y1: pad.top + h, y2: pad.top + h + 5, class: 'axis' }));
    svg.appendChild(
      el('text', { x: sx(x), y: pad.top + h + 20, class: 'tick', 'text-anchor': 'middle' }, formatX(x))
    );
  }

  svg.appendChild(el('line', { x1: pad.left, x2: pad.left + w, y1: pad.top + h, y2: pad.top + h, class: 'axis' }));

  if (marker !== null && marker >= xMin && marker <= xMax) {
    svg.appendChild(
      el('line', { x1: sx(marker), x2: sx(marker), y1: pad.top, y2: pad.top + h, class: 'marker' })
    );
    svg.appendChild(
      el('text', { x: sx(marker) + 6, y: pad.top + 12, class: 'marker-label' }, markerLabel)
    );
  }

  for (const r of reihen) {
    const d = punkte
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${sy(p.werte[r.key]).toFixed(2)}`)
      .join(' ');
    const attrs = { d, fill: 'none', stroke: r.farbe, 'stroke-width': 2.4, class: 'linie' };
    if (r.strich) attrs['stroke-dasharray'] = r.strich;
    svg.appendChild(el('path', attrs));
  }

  if (xLabel)
    svg.appendChild(
      el('text', { x: pad.left + w / 2, y: hoehe - 6, class: 'achsentitel', 'text-anchor': 'middle' }, xLabel)
    );
  if (yLabel)
    svg.appendChild(
      el(
        'text',
        {
          x: 14,
          y: pad.top + h / 2,
          class: 'achsentitel',
          'text-anchor': 'middle',
          transform: `rotate(-90 14 ${pad.top + h / 2})`,
        },
        yLabel
      )
    );

  // Hover-Auswertung
  const fokus = el('g', { class: 'fokus', style: 'display:none' });
  const fokusLinie = el('line', { y1: pad.top, y2: pad.top + h, class: 'fokus-linie' });
  fokus.appendChild(fokusLinie);
  const punkteNodes = reihen.map((r) => {
    const c = el('circle', { r: 4, fill: r.farbe, stroke: '#fff', 'stroke-width': 1.5 });
    fokus.appendChild(c);
    return c;
  });
  svg.appendChild(fokus);

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.style.display = 'none';

  svg.addEventListener('mousemove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * breite;
    const xWert = xMin + ((px - pad.left) / (w || 1)) * (xMax - xMin);
    let idx = 0;
    let best = Infinity;
    punkte.forEach((p, i) => {
      const d = Math.abs(p.x - xWert);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    const p = punkte[idx];
    fokus.setAttribute('style', 'display:block');
    fokusLinie.setAttribute('x1', sx(p.x));
    fokusLinie.setAttribute('x2', sx(p.x));
    reihen.forEach((r, i) => {
      punkteNodes[i].setAttribute('cx', sx(p.x));
      punkteNodes[i].setAttribute('cy', sy(p.werte[r.key]));
    });
    const zeilen = reihen
      .slice()
      .sort((a, b) => p.werte[a.key] - p.werte[b.key])
      .map(
        (r) =>
          `<div class="tt-zeile"><span class="tt-punkt" style="background:${r.farbe}"></span>${r.label}<b>${formatY(
            p.werte[r.key]
          )}</b></div>`
      )
      .join('');
    tooltip.innerHTML = `<div class="tt-kopf">${formatX(p.x)}</div>${zeilen}`;
    tooltip.style.display = 'block';
    const links = (sx(p.x) / breite) * rect.width;
    tooltip.style.left = `${Math.min(rect.width - 210, Math.max(0, links + 14))}px`;
    tooltip.style.top = `${Math.max(0, ev.clientY - rect.top - 20)}px`;
  });
  svg.addEventListener('mouseleave', () => {
    fokus.setAttribute('style', 'display:none');
    tooltip.style.display = 'none';
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'chart-wrapper';
  wrapper.appendChild(svg);
  wrapper.appendChild(tooltip);
  container.appendChild(wrapper);
}

/** Gruppiertes Saeulendiagramm. */
export function saeulenDiagramm(container, kategorien, reihen, optionen = {}) {
  const {
    breite = container.clientWidth || 760,
    hoehe = 320,
    formatY = (v) => String(Math.round(v)),
  } = optionen;
  container.innerHTML = '';
  if (!kategorien.length) return;

  const formatAchse = optionen.formatAchse ?? formatY;
  const pad = { top: 16, right: 16, bottom: 40, left: 76 };
  const w = breite - pad.left - pad.right;
  const h = hoehe - pad.top - pad.bottom;

  let yMax = 0;
  for (const k of kategorien) for (const r of reihen) yMax = Math.max(yMax, k.werte[r.key] ?? 0);
  const raster = nettesRaster(0, yMax * 1.05 || 1);

  const sy = (y) => pad.top + h - (y / (raster.ende || 1)) * h;
  const gruppeBreite = w / kategorien.length;
  const balkenBreite = Math.max(4, (gruppeBreite * 0.72) / reihen.length);

  const svg = el('svg', { viewBox: `0 0 ${breite} ${hoehe}`, width: '100%', height: hoehe, class: 'chart' });

  for (const t of raster.ticks) {
    svg.appendChild(el('line', { x1: pad.left, x2: pad.left + w, y1: sy(t), y2: sy(t), class: 'grid' }));
    svg.appendChild(
      el('text', { x: pad.left - 10, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, formatAchse(t))
    );
  }

  kategorien.forEach((k, gi) => {
    const basis = pad.left + gi * gruppeBreite + (gruppeBreite - balkenBreite * reihen.length) / 2;
    reihen.forEach((r, ri) => {
      const v = k.werte[r.key] ?? 0;
      const rect = el('rect', {
        x: basis + ri * balkenBreite,
        y: sy(v),
        width: balkenBreite - 1.5,
        height: Math.max(0, pad.top + h - sy(v)),
        fill: r.farbe,
        rx: 1.5,
      });
      rect.appendChild(el('title', {}, `${k.label} - ${r.label}: ${formatY(v)}`));
      svg.appendChild(rect);
    });
    svg.appendChild(
      el(
        'text',
        { x: pad.left + gi * gruppeBreite + gruppeBreite / 2, y: pad.top + h + 20, class: 'tick', 'text-anchor': 'middle' },
        k.label
      )
    );
  });

  svg.appendChild(el('line', { x1: pad.left, x2: pad.left + w, y1: pad.top + h, y2: pad.top + h, class: 'axis' }));
  container.appendChild(svg);
}

export function legende(container, reihen) {
  container.innerHTML = reihen
    .map(
      (r) =>
        `<span class="legende-eintrag"><i style="background:${r.farbe}${
          r.strich ? ';mask:repeating-linear-gradient(90deg,#000 0 4px,transparent 4px 7px)' : ''
        }"></i>${r.label}</span>`
    )
    .join('');
}
