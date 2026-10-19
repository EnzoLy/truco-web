/* Sistema de iconos heráldicos "Platería Criolla" para toda la baraja:
 * - Todos los palos (Oro, Copa, Espada, Basto) y las figuras (10 Yelmo, 11 Corcel, 12 Corona)
 *   comparten el mismo lenguaje visual: trazo firme de tinta, iluminación facetada 50/50,
 *   relieves en oro/plata y gemas geométricas.
 * - Tres variantes del mismo sistema:
 *   1. 'tradicional' (Criolla Clásica): Medallón heráldico completo con emblema arriba y palo abajo.
 *   2. 'emblema' (Criolla Reversible): Los mismos iconos de 10, 11 y 12 en espejo de dos cabezas (180°).
 *   3. 'linea' (Criolla Oro Imperial): Los mismos iconos bañados en oro bruñido y plata sobre esmalte oscuro. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Emblems = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GOLD = '#eab308';
  const GOLD_HI = '#fef08a';
  const GOLD_DARK = '#ca8a04';
  const GOLD_DEEP = '#854d0e';
  const SILVER = '#f1f5f9';
  const SILVER_MID = '#94a3b8';
  const INK = '#18100c';
  const STYLES = ['emblema', 'linea'];

  // ---------- PALOS HERÁLDICOS (caja 100x100) ----------

  function oroIcon(c, d, gilded = false) {
    const ringBg = gilded ? '#1e1510' : '#991b1b';
    const starMain = gilded ? GOLD_HI : GOLD;
    const starSub = gilded ? GOLD : c;
    return `
      <circle cx="50" cy="50" r="45" fill="${GOLD}" stroke="${INK}" stroke-width="2.6"/>
      <path d="M50 5A45 45 0 0 1 50 95Z" fill="${GOLD_DARK}" opacity=".45"/>
      <circle cx="50" cy="50" r="45" fill="none" stroke="${INK}" stroke-width="2.6"/>
      <circle cx="50" cy="50" r="37" fill="${ringBg}" stroke="${INK}" stroke-width="2"/>
      <circle cx="50" cy="50" r="31" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8"/>
      <path d="M50 19A31 31 0 0 1 50 81Z" fill="${GOLD}" opacity=".55"/>
      <path d="M27 27L44 39L73 27L61 44L73 73L56 61L27 73L39 56Z" fill="${starSub}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M50 16L58 42L84 50L58 58L50 84L42 58L16 50L42 42Z" fill="${starMain}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M50 16L58 42L84 50L58 58L50 84Z" fill="${GOLD_DARK}" opacity=".38"/>
      <path d="M50 16L58 42L84 50L58 58L50 84L42 58L16 50L42 42Z" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="50" cy="50" r="11" fill="${GOLD_HI}" stroke="${INK}" stroke-width="2"/>
      <path d="M50 42L58 50L50 58L42 50Z" fill="${c}" stroke="${INK}" stroke-width="1.6"/>
      <circle cx="50" cy="50" r="2.5" fill="${GOLD_HI}"/>
      <circle cx="50" cy="12" r="2.6" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.3"/>
      <circle cx="88" cy="50" r="2.6" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.3"/>
      <circle cx="50" cy="88" r="2.6" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.3"/>
      <circle cx="12" cy="50" r="2.6" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.3"/>`;
  }

  function copaIcon(c, d, gilded = false) {
    const cupFill = gilded ? GOLD : c;
    const cupShade = gilded ? GOLD_DEEP : d;
    return `
      <path d="M21 20H9L12 42L25 47L23 40L16 38L15 26H21Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M79 20H91L88 42L75 47L77 40L84 38L85 26H79Z" fill="${GOLD_DARK}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M20 93L33 78H67L80 93Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M50 78H67L80 93H50Z" fill="${GOLD_DARK}" opacity=".45"/>
      <path d="M20 93L33 78H67L80 93Z" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <rect x="14" y="91" width="72" height="7" rx="3" fill="${GOLD_HI}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M44 54H56L54 80H46Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M50 58L64 68L50 78L36 68Z" fill="${GOLD_HI}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M50 58L64 68L50 78Z" fill="${GOLD}" opacity=".5"/>
      <path d="M50 58L64 68L50 78L36 68Z" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="50" cy="68" r="3.6" fill="${c}" stroke="${INK}" stroke-width="1.4"/>
      <path d="M22 16C31 5 69 5 78 16Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M50 1L56 8L50 14L44 8Z" fill="${c}" stroke="${INK}" stroke-width="1.8"/>
      <path d="M17 17H83L77 45C73 55 62 60 50 60C38 60 27 55 23 45Z" fill="${cupFill}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M50 17H83L77 45C73 55 62 60 50 60Z" fill="${cupShade}" opacity=".45"/>
      <path d="M17 17H83L77 45C73 55 62 60 50 60C38 60 27 55 23 45Z" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M22 43L35 52L50 41L65 52L78 43C73 54 62 60 50 60C38 60 27 54 22 43Z" fill="${GOLD}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <rect x="13" y="13" width="74" height="7" rx="3" fill="${GOLD_HI}" stroke="${INK}" stroke-width="2.2"/>
      <circle cx="29" cy="16.5" r="2.2" fill="${c}" stroke="${INK}" stroke-width="1.1"/>
      <circle cx="50" cy="16.5" r="2.5" fill="${c}" stroke="${INK}" stroke-width="1.1"/>
      <circle cx="71" cy="16.5" r="2.2" fill="${c}" stroke="${INK}" stroke-width="1.1"/>`;
  }

  function espadaIcon(c, d, gilded = false) {
    const bladeL = gilded ? GOLD_HI : SILVER;
    const bladeR = gilded ? GOLD : SILVER_MID;
    const gripFill = gilded ? GOLD_DEEP : c;
    return `
      <path d="M38 66C36 56 45 55 46 66M62 66C64 56 55 55 54 66" fill="none" stroke="${GOLD}" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M38 66C36 56 45 55 46 66M62 66C64 56 55 55 54 66" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M50 1L57.5 16L56 66H44L42.5 16Z" fill="${bladeL}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M50 1L57.5 16L56 66H50Z" fill="${bladeR}"/>
      <path d="M50 1L57.5 16L56 66H44L42.5 16Z" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <line x1="50" y1="4" x2="50" y2="65" stroke="${INK}" stroke-width="1.5"/>
      <path d="M14 66C28 62 39 64.5 50 64.5C61 64.5 72 62 86 66C72 71.5 61 69.5 50 69.5C39 69.5 28 71.5 14 66Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="14" cy="66.5" r="3.4" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8"/>
      <circle cx="86" cy="66.5" r="3.4" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8"/>
      <rect x="46" y="69.5" width="8" height="20" rx="2.5" fill="${gripFill}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M46.5 74.5L53.5 76.5M46.5 79.5L53.5 81.5M46.5 84.5L53.5 86.5" stroke="${GOLD_HI}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M50 62L55.5 67L50 72L44.5 67Z" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="50" cy="94" r="5.2" fill="${GOLD}" stroke="${INK}" stroke-width="2.2"/>
      <circle cx="50" cy="94" r="2.2" fill="${GOLD_HI}"/>`;
  }

  function bastoIcon(c, d, gilded = false) {
    /* Garrote esbelto de rama nudosa: cabeza redondeada moderada (ancho 24) que afina hacia el mango (ancho 9) */
    const woodBase = gilded ? GOLD : '#9a5824';
    const woodShade = gilded ? GOLD_DEEP : '#5c3010';
    const woodHi = gilded ? GOLD_HI : '#d69658';
    const leafL = gilded ? GOLD_HI : '#22c55e';
    const leafR = gilded ? GOLD : '#168a45';
    return `
      <path d="M39 27C23 19 15 26 21 37C26 40 34 36 40 31Z" fill="${leafL}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M22 30C28 29 34 29 39 30" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M61 23C77 15 85 22 79 33C74 36 66 32 60 27Z" fill="${leafR}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M78 26C72 25 66 25 61 26" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M42 56C28 50 22 57 27 66C32 68 39 65 43 60Z" fill="${leafL}" stroke="${INK}" stroke-width="1.9" stroke-linejoin="round"/>
      <path d="M58 48C72 42 78 49 73 58C68 60 61 57 57 52Z" fill="${leafR}" stroke="${INK}" stroke-width="1.9" stroke-linejoin="round"/>
      <path d="M50 2C61 2 65 12 62 28C59 45 56 66 54.5 92C54 97.5 46 97.5 45.5 92C44 66 41 45 38 28C35 12 39 2 50 2Z" fill="${woodBase}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M50 2C61 2 65 12 62 28C59 45 56 66 54.5 92C54.2 95.5 52 97 50 97Z" fill="${woodShade}" opacity=".5"/>
      <path d="M43 8C39 16 40 28 43 44C45 58 47 74 48 91" fill="none" stroke="${woodHi}" stroke-width="2.4" stroke-linecap="round" opacity=".65"/>
      <path d="M50 2C61 2 65 12 62 28C59 45 56 66 54.5 92C54 97.5 46 97.5 45.5 92C44 66 41 45 38 28C35 12 39 2 50 2Z" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M46 11C45 26 46 46 48 70M53 12C54 30 53 54 52 84" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>
      <ellipse cx="45" cy="22" rx="4" ry="2.8" fill="${woodHi}" stroke="${INK}" stroke-width="1.6"/>
      <circle cx="45" cy="22" r="1.2" fill="${INK}"/>
      <ellipse cx="55" cy="39" rx="3.6" ry="2.5" fill="${woodHi}" stroke="${INK}" stroke-width="1.6"/>
      <circle cx="55" cy="39" r="1.1" fill="${INK}"/>
      <ellipse cx="48" cy="62" rx="3.2" ry="2.2" fill="${woodHi}" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="48" cy="62" r="1" fill="${INK}"/>
      <path d="M48 5C40 -2 27 3 31 13C37 15 44 12 48 5Z" fill="${leafL}" stroke="${INK}" stroke-width="1.9" stroke-linejoin="round"/>
      <path d="M52 5C60 -2 73 3 69 13C63 15 56 12 52 5Z" fill="${leafR}" stroke="${INK}" stroke-width="1.9" stroke-linejoin="round"/>`;
  }

  function pip(suit, style, colors) {
    const gilded = style === 'linea';
    if (suit === 'oro') return oroIcon(colors.c, colors.d, gilded);
    if (suit === 'copa') return copaIcon(colors.c, colors.d, gilded);
    if (suit === 'espada') return espadaIcon(colors.c, colors.d, gilded);
    return bastoIcon(colors.c, colors.d, gilded);
  }

  // ---------- ICONOS DE LAS FIGURAS (10 YELMO, 11 CORCEL, 12 CORONA en caja 120x196) ----------

  function crownCrest(c, d, gilded = false) {
    const cap = gilded ? GOLD_DEEP : d;
    return `
      <path d="M28 84C28 46 42 32 60 32C78 32 92 46 92 84Z" fill="${cap}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M60 32V84M44 36C40 52 42 68 44 84M76 36C80 52 78 68 76 84" fill="none" stroke="${GOLD_HI}" stroke-width="1.5" opacity=".7"/>
      <path d="M22 86L14 42L39 64L60 28L81 64L106 42L98 86Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M60 28L81 64L106 42L98 86H60Z" fill="${GOLD_DARK}" opacity=".45"/>
      <path d="M22 86L14 42L39 64L60 28L81 64L106 42L98 86Z" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <rect x="20" y="84" width="80" height="14" rx="3" fill="${GOLD_HI}" stroke="${INK}" stroke-width="2.2"/>
      <rect x="24" y="98" width="72" height="7" rx="2" fill="${c}" stroke="${INK}" stroke-width="1.8"/>
      <path d="M60 85L66 91L60 97L54 91Z" fill="${c}" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="36" cy="91" r="3.5" fill="${d}" stroke="${INK}" stroke-width="1.4"/>
      <circle cx="84" cy="91" r="3.5" fill="${d}" stroke="${INK}" stroke-width="1.4"/>
      <circle cx="14" cy="39" r="4.5" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8"/>
      <circle cx="39" cy="60" r="3.8" fill="${c}" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="60" cy="24" r="5" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8"/>
      <circle cx="81" cy="60" r="3.8" fill="${c}" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="106" cy="39" r="4.5" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8"/>`;
  }

  function horseCrest(c, d, gilded = false) {
    const body = gilded ? GOLD : c;
    const shade = gilded ? GOLD_DEEP : d;
    const mane = gilded ? GOLD_HI : GOLD;
    /* Silueta anatómica de corcel (estilo caballo de ajedrez Staunton):
     * orejas agudas, puente nasal recto, hocico y belfo marcados, quijada/carrillo definido,
     * garganta estrecha, pecho saliente y crin escalonada en mechones. */
    const manePath = 'M46 24L30 32L36 40L21 51L30 58L18 73L28 79L19 98H32C29 74 34 46 46 24Z';
    const headNeck = 'M28 98C26 72 32 46 46 26L44 12L52 22L57 9L62 23L68 27L99 47L101 54L96 60L87 58L91 63L85 66L72 62C68 61 65 57 65 53C61 66 67 82 80 98Z';
    return `
      <path d="${manePath}" fill="${mane}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M36 40L26 48M30 58L22 68M28 79L21 89" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="${headNeck}" fill="${body}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M62 23L68 27L99 47L101 54L96 60L87 58L91 63L85 66L72 62C65 58 62 48 64 38L52 64C54 78 60 90 66 98H80C67 82 61 66 65 53Z" fill="${shade}" opacity=".42"/>
      <path d="M65 53C65 46 69 40 76 42" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
      <path d="${headNeck}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M48 25L86 56M82 37L73 59M86 56L99 50" fill="none" stroke="${GOLD_HI}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="86" cy="56" r="3.4" fill="${GOLD}" stroke="${INK}" stroke-width="1.5"/>
      <path d="M70 33L78 35L74 39L69 36Z" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
      <circle cx="74" cy="36" r="1.5" fill="${INK}"/>
      <path d="M94 50L97 53L93 54Z" fill="${INK}"/>
      <rect x="18" y="96" width="68" height="8" rx="2.5" fill="${GOLD}" stroke="${INK}" stroke-width="2.2"/>
      <rect x="14" y="102" width="76" height="5" rx="2" fill="${GOLD_HI}" stroke="${INK}" stroke-width="1.8"/>`;
  }

  function helmCrest(c, d, gilded = false) {
    const helmL = gilded ? GOLD_HI : SILVER;
    const helmR = gilded ? GOLD : SILVER_MID;
    const plume = gilded ? c : GOLD;
    return `
      <path d="M58 26C76 8 102 8 108 22C96 24 86 30 76 40C90 32 104 34 106 44C92 46 78 48 64 52Z" fill="${plume}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M34 62C34 36 44 24 60 24C76 24 86 36 86 62L92 78L60 100L28 78Z" fill="${helmL}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M60 24C76 24 86 36 86 62L92 78L60 100Z" fill="${helmR}"/>
      <path d="M34 62C34 36 44 24 60 24C76 24 86 36 86 62L92 78L60 100L28 78Z" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M30 58L60 66L90 58L88 66L60 74L32 66Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.8"/>
      <path d="M57 24H63V98H57Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.6"/>
      <path d="M38 72L52 76M38 78L52 82M82 72L68 76M82 78L68 82" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M60 56L66 64L60 72L54 64Z" fill="${c}" stroke="${INK}" stroke-width="1.6"/>`;
  }

  const CRESTS = { 10: helmCrest, 11: horseCrest, 12: crownCrest };

  /* Variante 1 ('tradicional' o 'linea'): Medallón heráldico con el icono grande arriba y el palo abajo.
   * Variante 2 ('emblema'): Los mismos iconos de 10, 11 y 12 en espejo reversible (dos cabezas) con el palo en la banda central. */
  function court(num, suit, style, colors, pipSize = 42) {
    const gilded = style === 'linea';
    const icon = CRESTS[num](colors.c, colors.d, gilded);
    const frameBg = gilded ? '#1c120d' : colors.c;
    const frameOpacity = gilded ? '0.92' : '0.12';
    const outerFrame = `
      <path d="M18 4H102L114 16V180L102 192H18L6 180V16Z" fill="${frameBg}" fill-opacity="${frameOpacity}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M22 9H98L109 20V176L98 187H22L11 176V20Z" fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-linejoin="round"/>`;

    if (style === 'emblema') {
      /* Versión reversible de dos cabezas usando los mismos iconos de 10, 11 y 12 */
      const topIcon = `<g transform="translate(12 -4) scale(0.8)">${icon}</g>`;
      const miniPip = `<g transform="translate(44 82) scale(0.32)">${pip(suit, 'tradicional', colors)}</g>`;
      return `${outerFrame}
        <g>${topIcon}</g>
        <g transform="rotate(180 60 98)">${topIcon}</g>
        <line x1="14" y1="98" x2="42" y2="98" stroke="${GOLD}" stroke-width="2.5"/>
        <line x1="78" y1="98" x2="106" y2="98" stroke="${GOLD}" stroke-width="2.5"/>
        <circle cx="60" cy="98" r="20" fill="#fcf6e8" stroke="${INK}" stroke-width="2.2"/>
        <circle cx="60" cy="98" r="17" fill="none" stroke="${GOLD}" stroke-width="1.4"/>
        ${miniPip}`;
    }

    const divider = `
      <line x1="16" y1="120" x2="104" y2="120" stroke="${GOLD_DEEP}" stroke-width="2"/>
      <path d="M60 113L67 120L60 127L53 120Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.8"/>`;
    const small = `<g transform="translate(${60 - pipSize / 2} ${156 - pipSize / 2}) scale(${pipSize / 100})">${pip(suit, style, colors)}</g>`;
    return `${outerFrame}<g transform="translate(0 4)">${icon}</g>${divider}${small}`;
  }

  return { STYLES, pip, court, CRESTS };
});
