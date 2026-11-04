// Polish text utilities: tokenizing, a rough grapheme-to-phoneme converter,
// syllable counting and the (almost always penultimate) Polish word stress.

const LETTERS = "a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ";
const WORD_RE = new RegExp(`[${LETTERS}0-9]+(?:[-'’][${LETTERS}]+)*`, "g");

export const VOWEL_LETTERS = new Set(["a", "ą", "e", "ę", "i", "o", "ó", "u", "y"]);

/** Lower-cases and strips everything that is not part of a word. */
export function normalizeWord(w) {
  return (w || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-ząćęłńóśźż0-9-]/g, "").replace(/^-+|-+$/g, "");
}

/** Splits text into words, expanding digits into Polish number words. */
export function tokenize(text) {
  const out = [];
  for (const m of (text || "").matchAll(WORD_RE)) {
    const w = normalizeWord(m[0]);
    if (!w) continue;
    if (/^\d+$/.test(w)) out.push(...numberToWords(parseInt(w, 10)));
    else out.push(w);
  }
  return out;
}

/** Same as tokenize but keeps the original surface form and offsets (for display). */
export function tokenizeWithSpans(text) {
  const out = [];
  for (const m of (text || "").matchAll(WORD_RE)) {
    const w = normalizeWord(m[0]);
    if (!w) continue;
    out.push({ word: w, surface: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const ONES = ["zero", "jeden", "dwa", "trzy", "cztery", "pięć", "sześć", "siedem", "osiem", "dziewięć",
  "dziesięć", "jedenaście", "dwanaście", "trzynaście", "czternaście", "piętnaście", "szesnaście",
  "siedemnaście", "osiemnaście", "dziewiętnaście"];
const TENS = ["", "", "dwadzieścia", "trzydzieści", "czterdzieści", "pięćdziesiąt", "sześćdziesiąt",
  "siedemdziesiąt", "osiemdziesiąt", "dziewięćdziesiąt"];
const HUNDREDS = ["", "sto", "dwieście", "trzysta", "czterysta", "pięćset", "sześćset", "siedemset",
  "osiemset", "dziewięćset"];

/** Cardinal numbers 0–9999 in the nominative (speech recognisers often return digits). */
export function numberToWords(n) {
  if (!Number.isFinite(n) || n < 0 || n > 9999) return [String(n)];
  if (n < 20) return [ONES[n]];
  const words = [];
  const th = Math.floor(n / 1000);
  if (th) {
    if (th === 1) words.push("tysiąc");
    else words.push(ONES[th], th >= 2 && th <= 4 ? "tysiące" : "tysięcy");
  }
  const rest = n % 1000;
  const h = Math.floor(rest / 100);
  if (h) words.push(HUNDREDS[h]);
  const t = rest % 100;
  if (t >= 20) {
    words.push(TENS[Math.floor(t / 10)]);
    if (t % 10) words.push(ONES[t % 10]);
  } else if (t > 0) words.push(ONES[t]);
  return words;
}

export function stripDiacritics(w) {
  return w.replace(/ą/g, "a").replace(/ć/g, "c").replace(/ę/g, "e").replace(/ł/g, "l").replace(/ń/g, "n")
    .replace(/ó/g, "o").replace(/ś/g, "s").replace(/[źż]/g, "z");
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Word similarity in [0,1]; ignores case/punctuation, small penalty for diacritics only. */
export function wordSimilarity(a, b) {
  a = normalizeWord(a);
  b = normalizeWord(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sa = stripDiacritics(a), sb = stripDiacritics(b);
  if (sa === sb) return 0.85;
  // Compare on phoneme level so "rz" vs "ż" or "ch" vs "h" count as equal sounds.
  const pa = g2p(a).map((t) => t.p), pb = g2p(b).map((t) => t.p);
  if (pa.join(" ") === pb.join(" ")) return 0.97;
  const d = levenshtein(pa, pb);
  return Math.max(0, 1 - d / Math.max(pa.length, pb.length));
}

// ---------------------------------------------------------------------------
// Grapheme-to-phoneme (simplified, enough to compare words sound-by-sound).
// Phoneme symbols (ASCII-ish): a e i o u y on(ą) en(ę) p b t d k g f v s z x(h/ch)
// m n l w(ł) j r ts dz cz(tʂ) dzh(dʐ) sz(ʂ) zh(ʐ, ż/rz) si(ɕ) zi(ʑ) ci(tɕ) dzi(dʑ) ni(ɲ)
// ---------------------------------------------------------------------------

export const VOWEL_PHONES = new Set(["a", "e", "i", "o", "u", "y", "on", "en"]);
const SOFTENABLE = { s: "si", z: "zi", c: "ci", dz: "dzi", n: "ni" };

/**
 * Returns an array of {p, letters, syl} where `syl` is the syllable index of a vowel
 * (null for consonants) and `letters` the spelling it came from.
 */
export function g2p(word) {
  const w = normalizeWord(word).replace(/-/g, "");
  const out = [];
  let i = 0;
  const isV = (ch) => VOWEL_LETTERS.has(ch);
  while (i < w.length) {
    const rest = w.slice(i);
    let p = null, len = 1;
    const two = rest.slice(0, 2), three = rest.slice(0, 3);
    if (three === "dzi") {
      p = "dzi";
      len = isV(rest[3]) ? 3 : 2; // "dzia" -> dź + a, "dzik" -> dź + i
    } else if (two === "dż") { p = "dzh"; len = 2; }
    else if (two === "dź") { p = "dzi"; len = 2; }
    else if (two === "dz") { p = "dz"; len = 2; }
    else if (two === "cz") { p = "cz"; len = 2; }
    else if (two === "sz") { p = "sz"; len = 2; }
    else if (two === "rz") { p = "zh"; len = 2; }
    else if (two === "ch") { p = "x"; len = 2; }
    else if ((two === "si" || two === "zi" || two === "ci" || two === "ni")) {
      p = SOFTENABLE[two[0]];
      len = isV(rest[2]) ? 2 : 1; // "sia" -> ś + a ; "sit" -> ś + i
      if (len === 1) { out.push({ p, letters: two[0] }); i += 1; out.push({ p: "i", letters: "i" }); i += 1; continue; }
    } else {
      const ch = rest[0];
      const map = { "ą": "on", "ę": "en", "ó": "u", "ł": "w", "w": "v", "ż": "zh", "ś": "si", "ź": "zi",
        "ć": "ci", "ń": "ni", "h": "x", "c": "ts", "y": "y", "e": "e", "a": "a", "o": "o", "u": "u",
        "i": "i", "j": "j", "q": "k", "x": "ks" };
      p = map[ch] || ch;
      // consonant + i + vowel: the "i" only softens (pies, miasto) -> consonant + j
      if (ch === "i" && out.length && !VOWEL_PHONES.has(out[out.length - 1].p) && isV(rest[1]) && i > 0) {
        p = "j";
      }
    }
    if (p === "ks") { out.push({ p: "k", letters: "x" }, { p: "s", letters: "" }); i += len; continue; }
    out.push({ p, letters: w.slice(i, i + len) });
    i += len;
  }
  let syl = 0;
  for (const t of out) {
    if (VOWEL_PHONES.has(t.p)) t.syl = syl++;
    else t.syl = null;
  }
  return out;
}

export function syllableCount(word) {
  return g2p(word).filter((t) => t.syl !== null).length;
}

const ANTEPENULT_SUFFIXES = ["liśmy", "łyśmy", "liście", "łyście", "aśmy", "eśmy", "iśmy", "yśmy",
  "aście", "eście", "iście", "yście"];
// muzyka, fizyka, matematyka, Ameryka: stress on the third syllable from the end
const ANTEPENULT_GREEK = /(?:yka|ika|yką|iką|ykę|ikę)$/;

/** Index of the stressed syllable (0-based) or -1 for words without vowels. */
export function stressIndex(word) {
  const w = normalizeWord(word);
  const n = syllableCount(w);
  if (n === 0) return -1;
  if (n === 1) return 0;
  if (n >= 3) {
    if (ANTEPENULT_SUFFIXES.some((s) => w.endsWith(s))) return n - 3;
    if (ANTEPENULT_GREEK.test(w)) return n - 3;
  }
  return n - 2;
}

/** Human readable syllables with the stressed one in capitals, e.g. "te-LE-fon". */
export function stressPattern(word) {
  const w = normalizeWord(word);
  const toks = g2p(w);
  const n = toks.filter((t) => t.syl !== null).length;
  if (n < 2) return w;
  const s = stressIndex(w);
  // split letters into syllables: each consonant cluster before a vowel goes with it,
  // except that the first consonant of a multi-consonant cluster closes the previous syllable.
  const groups = [];
  let cur = "";
  let pendingCons = [];
  for (const t of toks) {
    if (t.syl === null) {
      pendingCons.push(t.letters);
    } else {
      if (groups.length || cur) {
        // onset maximisation, except a sonorant closes the syllable: kar-ta, pol-ska
        const keep = pendingCons.length > 1 && pendingCons[1] !== "i" && /^(r|l|ł|m|n|j)$/.test(pendingCons[0]) ? 1 : 0;
        cur += pendingCons.slice(0, keep).join("");
        groups.push(cur);
        cur = pendingCons.slice(keep).join("") + t.letters;
      } else {
        cur = pendingCons.join("") + t.letters;
      }
      pendingCons = [];
    }
  }
  cur += pendingCons.join("");
  groups.push(cur);
  return groups.map((g, i) => (i === s ? g.toUpperCase() : g)).join("-");
}

/** Splits text into sentences for display. */
export function splitSentences(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[„"«(—–-]?[A-ZĄĆĘŁŃÓŚŹŻ0-9„"«—–-])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
