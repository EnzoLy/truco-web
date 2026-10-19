/* Baraja española con estética unificada "Platería Criolla":
 * - Los 10 (Yelmo), 11 (Corcel) y 12 (Corona) usan los iconos heráldicos criollos en todas las variantes.
 * - Los 4 palos (Oro, Copa, Espada, Basto) y los Ases siguen exactamente el mismo estilo de grabado
 *   facetado con iluminación 50/50, contornos firmes de tinta y engastes de oro. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CardArt = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const Emblems = typeof module === 'object' && module.exports ? require('./emblems.js') : self.Emblems;
  const W = 200;
  const H = 300;
  const INK = '#18100c';
  const GOLD = '#eab308';
  const GOLD_HI = '#fef08a';
  const GOLD_MID = '#ca8a04';
  const WHITE = '#ffffff';
  const CREAM = '#fcf6e8';

  /* c = color principal del palo, d = sombra profunda, frame = filete, hi = luz */
  const SUITS = {
    oro: { c: '#d99b16', d: '#784906', frame: '#b4780e', hi: '#fde047', cuts: 0 },
    copa: { c: '#cf2233', d: '#6e0b17', frame: '#9e1625', hi: '#fb7185', cuts: 1 },
    espada: { c: '#2563eb', d: '#152c69', frame: '#1d4496', hi: '#93c5fd', cuts: 2 },
    basto: { c: '#168a45', d: '#0b4622', frame: '#126934', hi: '#86efac', cuts: 3 },
  };

  const PIP_SIZE = 100;
  const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

  const stroke = (w = 2.4) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

  // ---------- PALOS Y DISPOSICIÓN ----------

  function pipArt(suit, art = currentArt) {
    return Emblems.pip(suit, art, SUITS[suit]);
  }

  const PIP_SCALE = { oro: 1.04, copa: 1.12, espada: 1.2, basto: 1.2 };

  const placePip = (suit, cx, cy, size, art, flip = false) => {
    const boost = size < 100 ? PIP_SCALE[suit] : 1;
    const s = ((size * boost) / PIP_SIZE).toFixed(3);
    const rot = flip ? ' rotate(180)' : '';
    return `<g transform="translate(${cx} ${cy})${rot} scale(${s}) translate(-50 -50)">${pipArt(suit, art)}</g>`;
  };

  /* Los Ases ("los anchos") van enmarcados en el mismo escudo octogonal criollo que el 10, 11 y 12 */
  function aceArt(suit, art) {
    const s = SUITS[suit];
    const gilded = art === 'linea';
    const bg = gilded ? '#1c120d' : s.c;
    const op = gilded ? '0.92' : '0.12';
    return `
      <path d="M58 52H142L154 64V236L142 248H58L46 236V64Z" fill="${bg}" fill-opacity="${op}" ${stroke(2.4)}/>
      <path d="M62 57H138L149 68V232L138 243H62L51 232V68Z" fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M100 68L142 150L100 232L58 150Z" fill="${GOLD}" fill-opacity=".14" stroke="${GOLD}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M100 45L107 52L100 59L93 52Z" fill="${GOLD}" ${stroke(1.8)}/>
      <path d="M100 241L107 248L100 255L93 248Z" fill="${GOLD}" ${stroke(1.8)}/>
      ${placePip(suit, 100, 150, 146, art)}`;
  }

  const COL_L = 64;
  const COL_R = 136;
  const COL_C = 100;
  const ROWS = [68, 150, 232];
  const PIP_LAYOUTS = {
    2: { size: 78, at: [[72, 82], [128, 218]] },
    3: { size: 72, at: [[66, 82], [134, 82], [COL_C, 218]] },
    4: { size: 68, at: [[COL_L, 76], [COL_R, 76], [COL_L, 224], [COL_R, 224]] },
    5: { size: 66, at: [[COL_L, 74], [COL_R, 74], [COL_L, 226], [COL_R, 226], [COL_C, 150]] },
    6: { size: 62, at: ROWS.flatMap((y) => [[COL_L, y], [COL_R, y]]) },
    7: { size: 62, at: [...ROWS.flatMap((y) => [[COL_L, y], [COL_R, y]]), [COL_C, 109]] },
  };

  // ---------- FIGURAS (10, 11, 12 con los iconos de Platería Criolla) ----------

  const FIG = { x: 40, y: 52 };

  function figureArt(card, art = currentArt) {
    const suit = SUITS[card.suit];
    return `<g transform="translate(${FIG.x} ${FIG.y})">${Emblems.court(card.num, card.suit, art, suit)}</g>`;
  }

  // ---------- MARCOS, PINTAS E ÍNDICES ----------

  const DEFS = `<defs>
    <linearGradient id="paperClasica" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#fffdf7"/><stop offset="100%" stop-color="#f3e8ce"/></linearGradient>
    <linearGradient id="paperEbano" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1e1512"/><stop offset="100%" stop-color="#0f0907"/></linearGradient>
  </defs>`;

  function pintas(cuts, y, bgColor, strokeColor) {
    if (!cuts) return '';
    const span = 38;
    const gap = 7;
    let marks = '';
    for (let i = 0; i < cuts; i++) {
      const x = 100 + (i - (cuts - 1) / 2) * (span / Math.max(1, cuts));
      marks += `<line x1="${(x - gap / 2).toFixed(1)}" y1="${y}" x2="${(x + gap / 2).toFixed(1)}" y2="${y}" stroke="${bgColor}" stroke-width="5"/>`;
      marks += `<circle cx="${(x - gap / 2).toFixed(1)}" cy="${y}" r="1.4" fill="${strokeColor}"/><circle cx="${(x + gap / 2).toFixed(1)}" cy="${y}" r="1.4" fill="${strokeColor}"/>`;
    }
    return marks;
  }

  function corners(color) {
    const gem = (x, y) => `<path d="M${x} ${y - 5.5}L${x + 5.5} ${y}L${x} ${y + 5.5}L${x - 5.5} ${y}Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="1.8" fill="${color}"/>`;
    return gem(19, 19) + gem(181, 19) + gem(181, 281) + gem(19, 281);
  }

  const INDEX_FONT = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";

  function indexMark(card, color, skin, art) {
    const inkColor = skin === 'ebano' ? GOLD_HI : color;
    const numSize = card.num >= 10 ? 23 : 27;
    const num = `<text x="24" y="40" text-anchor="middle" font-family="${INDEX_FONT}" font-weight="700" font-size="${numSize}" fill="${inkColor}">${card.num}</text>`;
    const icon = `<g transform="translate(15 45) scale(.18)">${pipArt(card.suit, art)}</g>`;
    return `${num}${icon}`;
  }

  const SKIN_NAMES = ['clasica', 'marfil', 'ebano'];
  let currentSkin = 'clasica';
  const ART_NAMES = ['tradicional', ...Emblems.STYLES];
  let currentArt = 'tradicional';

  function frame(skin, suit) {
    if (skin === 'marfil') {
      return `<rect x="1.5" y="1.5" width="197" height="297" rx="16" fill="${WHITE}" stroke="#d6cfc2" stroke-width="2.5"/>
        <rect x="8" y="8" width="184" height="284" rx="11" fill="none" stroke="${GOLD}" stroke-width="1.2"/>
        <rect x="12" y="12" width="176" height="276" rx="8" fill="none" stroke="${suit.c}" stroke-width="2.2"/>
        ${pintas(suit.cuts, 12, WHITE, suit.c)}${pintas(suit.cuts, 288, WHITE, suit.c)}`;
    }
    if (skin === 'ebano') {
      return `<rect x="1.5" y="1.5" width="197" height="297" rx="15" fill="url(#paperEbano)" stroke="${GOLD_MID}" stroke-width="2.8"/>
        <rect x="8" y="8" width="184" height="284" rx="10" fill="none" stroke="${GOLD_HI}" stroke-width="1.6"/>
        <rect x="12" y="12" width="176" height="276" rx="7" fill="none" stroke="${suit.hi}" stroke-width="1.2" opacity=".85"/>
        ${pintas(suit.cuts, 8, '#16100e', GOLD_HI)}${pintas(suit.cuts, 292, '#16100e', GOLD_HI)}
        ${corners(suit.hi)}`;
    }
    return `<rect x="1.5" y="1.5" width="197" height="297" rx="15" fill="url(#paperClasica)" ${stroke(2.8)}/>
      <rect x="8" y="8" width="184" height="284" rx="10" fill="none" stroke="${GOLD_MID}" stroke-width="2.2"/>
      <rect x="12" y="12" width="176" height="276" rx="7" fill="none" stroke="${suit.frame}" stroke-width="2"/>
      ${pintas(suit.cuts, 12, CREAM, suit.frame)}${pintas(suit.cuts, 288, CREAM, suit.frame)}
      ${corners(suit.frame)}`;
  }

  function faceSvg(card, skin = currentSkin, art = currentArt) {
    const suit = SUITS[card.suit];
    const mark = indexMark(card, suit.d, skin, art);
    let drawing;
    if (card.num >= 10) {
      drawing = figureArt(card, art);
    } else if (card.num === 1) {
      drawing = aceArt(card.suit, art);
    } else {
      const layout = PIP_LAYOUTS[card.num];
      const flipBottom = card.suit === 'espada' || card.suit === 'basto' || card.suit === 'copa';
      const bravo = card.num === 7 && (card.suit === 'espada' || card.suit === 'oro')
        ? `<path d="M100 73L136 109L100 145L64 109Z" fill="${GOLD_HI}" fill-opacity=".28" stroke="${GOLD}" stroke-width="1.6" stroke-linejoin="round"/>`
        : '';
      const pips = layout.at
        .map(([x, y]) => placePip(card.suit, x, y, layout.size, art, flipBottom && y > 185))
        .join('');
      drawing = `${bravo}${pips}`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${DEFS}
      ${frame(skin, suit)}
      ${mark}
      <g transform="rotate(180 100 150)">${mark}</g>
      ${drawing}
    </svg>`;
  }

  function backSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs>
        <pattern id="lattice" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M10 0L20 10L10 20L0 10Z" fill="none" stroke="#eab308" stroke-width="1" opacity=".45"/>
          <circle cx="10" cy="10" r="1.5" fill="#fef08a" opacity=".6"/>
        </pattern>
        <radialGradient id="backBg" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#881337"/><stop offset="65%" stop-color="#4c0519"/><stop offset="100%" stop-color="#1f030b"/></radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="197" height="297" rx="15" fill="${CREAM}" ${stroke(2.8)}/>
      <rect x="9" y="9" width="182" height="282" rx="10" fill="url(#backBg)" stroke="#ca8a04" stroke-width="2.5"/>
      <rect x="13" y="13" width="174" height="274" rx="7" fill="url(#lattice)"/>
      <path d="M32 22H168L178 32V268L168 278H32L22 268V32Z" fill="none" stroke="#fef08a" stroke-width="1.6"/>
      <path d="M100 84L146 150L100 216L54 150Z" fill="#3b0714" ${stroke(2.4)}/>
      <path d="M100 92L138 150L100 208L62 150Z" fill="none" stroke="#eab308" stroke-width="1.6"/>
      <path d="M100 112L110 140L138 150L110 160L100 188L90 160L62 150L90 140Z" fill="#eab308" ${stroke(2)}/>
      <circle cx="100" cy="150" r="12" fill="#881337" ${stroke(2)}/>
      <path d="M100 143L107 150L100 157L93 150Z" fill="#fef08a" ${stroke(1.4)}/>
      ${corners('#881337')}
    </svg>`;
  }

  /** Estructura básica: etiquetas balanceadas y sin valores NaN. Sirve para los tests. */
  function validateSvg(svg) {
    const problems = [];
    if (/NaN|undefined/.test(svg)) problems.push('contiene NaN o undefined');
    const stack = [];
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      const [, closing, name, selfClosing] = m;
      if (selfClosing) continue;
      if (closing) {
        if (stack.pop() !== name) problems.push(`cierre inesperado </${name}>`);
      } else stack.push(name);
    }
    if (stack.length) problems.push(`sin cerrar: ${stack.join(',')}`);
    return problems;
  }

  const toUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const cache = new Map();
  const memo = (key, build) => {
    if (!cache.has(key)) cache.set(key, toUrl(build()));
    return cache.get(key);
  };

  const url = (card) => memo(`${currentSkin}-${currentArt}-${card.num}${card.suit}`, () => faceSvg(card));
  const backUrl = () => memo('back', backSvg);

  const setSkin = (name) => { if (SKIN_NAMES.includes(name)) currentSkin = name; return currentSkin; };
  const setArt = (name) => { if (ART_NAMES.includes(name)) currentArt = name; return currentArt; };

  return { W, H, NUMBERS, SUITS, PIP_LAYOUTS, SKIN_NAMES, ART_NAMES, setArt, faceSvg, backSvg, validateSvg, url, backUrl, setSkin };
});
