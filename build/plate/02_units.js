/* ==========================================================================
   SHARED: units
   Decimal feet, square feet, percent, and parsing of typed values.
   Feet and square feet only (version 1).
   ========================================================================== */
const Units = (() => {
  const grouped = (n, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  /** 312.5 -> 312'-6"  (rounds to the nearest inch) */
  function formatFeetInches(ft) {
    if (typeof ft !== 'number' || !isFinite(ft)) return '—';
    const totalIn = Math.round(Math.abs(ft) * 12);
    const f = Math.floor(totalIn / 12), i = totalIn % 12;
    return `${ft < 0 && totalIn > 0 ? '-' : ''}${grouped(f)}'-${i}"`;
  }
  /** 100000 -> "100,000 sf" */
  function formatArea(sf) {
    if (typeof sf !== 'number' || !isFinite(sf)) return '—';
    return `${grouped(Math.round(sf) || 0)} sf`;
  }
  /** 1.625 -> "1.63 ft" */
  const formatFt = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? `${grouped(v, d)} ft` : '—');
  /** 1234.56 -> "1,234.6 sf" */
  const formatAreaDec = (sf, d = 1) => (typeof sf === 'number' && isFinite(sf) ? `${grouped(sf, d)} sf` : '—');
  const formatSigned = (v, f) => (typeof v === 'number' && isFinite(v) ? `${v > 0.00001 ? '+' : v < -0.00001 ? '−' : '±'}${f(Math.abs(v))}` : '—');
  /** 0.0833 -> "8.3%" */
  const formatPct = (f, d = 1) => (typeof f === 'number' && isFinite(f) ? `${grouped(f * 100, d)}%` : '—');
  const formatInt = (n) => (typeof n === 'number' && isFinite(n)) ? grouped(Math.round(n) || 0) : '—';
  const formatRatio = (n, d = 2) => (typeof n === 'number' && isFinite(n)) ? grouped(n, d) : '—';
  const formatDeg = (n) => `${Math.round(n)}°`;

  /** Parse "10'-6\"", "10.5", "10'", "10' 6", "6\"", "10 ft 6 in", "10-6", "6 1/2\"" to feet. NaN when invalid. */
  function parseLength(input) {
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    let s = String(input == null ? '' : input).trim().toLowerCase();
    s = s.replace(/[, ]/g, '').replace(/[′’‘]/g, "'").replace(/[″“”]/g, '"').replace(/\s+/g, ' ');
    if (!s) return NaN;
    let sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1).trim(); } else if (s[0] === '+') { s = s.slice(1).trim(); }
    const NUM = '(\\d+\\.?\\d*|\\.\\d+)';
    if (new RegExp('^' + NUM + '$').test(s)) return sign * parseFloat(s);

    const parseInches = (t) => {
      t = t.trim().replace(/\s*(?:"|in\.?|inch|inches)$/, '').trim();
      if (t === '') return 0;
      let m;
      if ((m = t.match(new RegExp('^' + NUM + '$')))) return parseFloat(m[1]);
      if ((m = t.match(/^(\d+)\s*\/\s*(\d+)$/))) return +m[2] ? m[1] / m[2] : NaN;
      if ((m = t.match(new RegExp('^' + NUM + '\\s+(\\d+)\\s*/\\s*(\\d+)$')))) return +m[3] ? parseFloat(m[1]) + m[2] / m[3] : NaN;
      return NaN;
    };
    let m;
    if ((m = s.match(new RegExp('^' + NUM + "\\s*(?:'|ft\\.?|feet|foot)\\s*-?\\s*(.*)$")))) {
      const inch = parseInches(m[2]);
      return isNaN(inch) ? NaN : sign * (parseFloat(m[1]) + inch / 12);
    }
    if (/("|in\.?|inch|inches)$/.test(s)) {
      const inch = parseInches(s);
      return isNaN(inch) ? NaN : sign * inch / 12;
    }
    if ((m = s.match(new RegExp('^' + NUM + '\\s*-\\s*(.+)$')))) {   // architect shorthand: 10-6
      const inch = parseInches(m[2]);
      return isNaN(inch) ? NaN : sign * (parseFloat(m[1]) + inch / 12);
    }
    return NaN;
  }
  /** Plain number with optional unit decoration ("45°", "20%", "1,200 sf"). NaN when invalid. */
  function parseNumber(input) {
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    const s = String(input == null ? '' : input).replace(/[,\s°%]|sf$/gi, '');
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
  }
  return { formatFeetInches, formatArea, formatAreaDec, formatFt, formatSigned, formatPct, formatInt, formatRatio, formatDeg, parseLength, parseNumber, grouped };
})();
