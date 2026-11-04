// Turns speech-recognition output into pronunciation feedback.
//  * GuidedSession: the learner reads a known text; we align what was heard to it,
//    allowing repetitions (people repeat difficult words/sentences).
//  * analyzeFree: no reference text (physical book) — we look at repetitions,
//    self-corrections and recogniser confidence.
// Both produce the same report shape.

import { tokenize, tokenizeWithSpans, wordSimilarity, g2p, stressIndex, normalizeWord, syllableCount } from "./polish.js";
import { patternsInWord, PATTERN_BY_ID, severityFor, relevantPatterns } from "./profiles.js";

const GOOD = 0.97;
const CLOSE = 0.75;

// ---------------------------------------------------------------------------
// Sound-level diagnosis of one misheard word
// ---------------------------------------------------------------------------

function alignPhones(E, H) {
  const m = E.length, n = H.length;
  const D = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) D[i][0] = i;
  for (let j = 0; j <= n; j++) D[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = E[i - 1].p === H[j - 1].p ? 0 : 1;
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + c);
    }
  }
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (E[i - 1].p === H[j - 1].p ? 0 : 1)) {
      if (E[i - 1].p !== H[j - 1].p) ops.push({ type: "sub", e: i - 1, h: j - 1 });
      i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      ops.push({ type: "del", e: i - 1 });
      i--;
    } else {
      ops.push({ type: "ins", e: i, h: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

const SOFTENED = { t: "ci", d: "dzi", s: "si", z: "zi", n: "ni", ts: "ci", dz: "dzi" };
const HARD_SIB = new Set(["cz", "sz", "zh", "dzh"]);
const SOFT_SIB = new Set(["si", "ci", "zi", "dzi", "ni"]);
const PLAIN_SIB = new Set(["s", "z", "ts", "dz", "t", "d", "n"]);
const VOICELESS = new Set(["p", "t", "k", "f", "s", "sz", "si", "ci", "cz", "ts", "x"]);

/**
 * Compares an expected word with what the recogniser heard and returns the
 * likely accent patterns behind the difference: [{id, from, to}].
 */
export function diagnose(expected, heard) {
  const exp = normalizeWord(expected), hrd = normalizeWord(heard);
  if (!exp || !hrd || exp === hrd) return [];
  const E = g2p(exp), H = g2p(hrd);
  if (!E.length || !H.length) return [];
  const stress = stressIndex(exp);
  const ops = alignPhones(E, H);
  const found = [];
  const add = (id, from, to) => found.push({ id, from, to });
  // Too different: it is a different word, not an accent detail.
  if (ops.length > Math.max(2, Math.ceil(E.length * 0.5))) return [{ id: "clarity", from: exp, to: hrd }];

  for (const op of ops) {
    const e = op.e !== undefined && op.e < E.length ? E[op.e] : null;
    const h = op.h !== undefined ? H[op.h] : null;
    if (op.type === "sub") {
      const ep = e.p, hp = h.p;
      const next = E[op.e + 1];
      if (ep === "o" && hp === "a") add("akanie", "o", "a");
      else if (ep === "o" && hp === "u") add("open_o", "o", "u");
      else if (ep === "e" && (hp === "a" || hp === "i" || hp === "y")) {
        add("yakanie", "e", hp);
      } else if ((ep === "y" && hp === "i") || (ep === "i" && hp === "y")) add("y_i", ep, hp);
      else if ((ep === "w" && (hp === "l" || hp === "v")) || (ep === "l" && hp === "w")) add("l_sounds", ep === "w" ? "ł" : "l", hp === "w" ? "ł" : hp);
      else if (HARD_SIB.has(ep) && (SOFT_SIB.has(hp) || PLAIN_SIB.has(hp))) add("cz_hard", ep, hp);
      else if (SOFT_SIB.has(ep) && (PLAIN_SIB.has(hp) || HARD_SIB.has(hp) || hp === "j")) add("soft_sibilants", ep, hp);
      else if ((ep === "on" || ep === "en") || (hp === "on" || hp === "en")) add("nasals", ep, hp);
      else if (ep === "g" && (hp === "x" || hp === "k")) add("g_plosive", "g", hp);
      else if (ep === "x" && (hp === "g" || hp === "k")) add("h_voiceless", "h", hp);
      else if (SOFTENED[ep] === hp) add("palatal_e", ep, hp);
      else if (ep === "v" && (hp === "w" || hp === "u") && (op.e === E.length - 1 || VOICELESS.has(next?.p))) add("w_final", "w", hp);
      else if ((ep === "a" && hp === "o") || (ep === "u" && hp === "o")) add("open_o", ep, hp);
      else add("clarity", ep, hp);
    } else if (op.type === "ins") {
      if (op.e === 0 && (h.p === "v" || h.p === "w") && E[0] && (E[0].p === "o" || E[0].p === "u")) add("prothesis", "", h.p);
      else if ((h.p === "n" || h.p === "m") && E[op.e - 1] && (E[op.e - 1].p === "on" || E[op.e - 1].p === "en")) add("nasals", E[op.e - 1].p, E[op.e - 1].p + "+" + h.p);
      else add("clarity", "", h.p);
    } else if (op.type === "del") {
      if (e.p === "v" && (op.e === E.length - 1 || VOICELESS.has(E[op.e + 1]?.p))) add("w_final", "w", "");
      else if (e.p === "j" && SOFT_SIB.has(E[op.e - 1]?.p)) continue;
      else add("clarity", e.p, "");
    }
  }
  // de-duplicate
  const seen = new Set();
  return found.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

// ---------------------------------------------------------------------------
// Guided reading
// ---------------------------------------------------------------------------

function matchScore(sim) {
  if (sim >= GOOD) return 3;
  if (sim >= CLOSE) return 1.5;
  if (sim >= 0.5) return 0.4;
  return -1.5;
}

/**
 * Local (Smith–Waterman) alignment of a heard phrase against a window of the
 * reference. Returns ops: {type:'match', ref, heard, sim} | {type:'skip', ref} | {type:'ins', heard}
 */
export function alignPhrase(refWords, heardWords, cursor) {
  const n = refWords.length, m = heardWords.length;
  if (!n || !m) return { ops: [], start: cursor, end: cursor - 1 };
  const lo = Math.max(0, cursor - 60);
  const hi = Math.min(n, cursor + 80 + m);
  const W = hi - lo;
  const S = Array.from({ length: m + 1 }, () => new Float32Array(W + 1));
  const B = Array.from({ length: m + 1 }, () => new Uint8Array(W + 1)); // 0 stop,1 diag,2 up(ins),3 left(skip)
  const simCache = Array.from({ length: m }, () => new Float32Array(W).fill(-1));
  const simAt = (i, j) => {
    let v = simCache[i][j];
    if (v < 0) { v = wordSimilarity(heardWords[i], refWords[lo + j]); simCache[i][j] = v; }
    return v;
  };
  const GAP_INS = -1.2, GAP_SKIP = -1.0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= W; j++) {
      const d = S[i - 1][j - 1] + matchScore(simAt(i - 1, j - 1));
      const u = S[i - 1][j] + GAP_INS;
      const l = S[i][j - 1] + GAP_SKIP;
      let best = 0, b = 0;
      if (d > best) { best = d; b = 1; }
      if (u > best) { best = u; b = 2; }
      if (l > best) { best = l; b = 3; }
      S[i][j] = best;
      B[i][j] = b;
    }
  }
  // pick the best end cell, preferring alignments near the cursor
  let bestVal = 0, bi = 0, bj = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= W; j++) {
      if (S[i][j] <= 0 || B[i][j] !== 1) continue;
      const dist = Math.abs(lo + j - 1 - (cursor + i - 1));
      const val = S[i][j] - 0.03 * dist + 0.2 * i;
      if (val > bestVal) { bestVal = val; bi = i; bj = j; }
    }
  }
  if (!bi) return { ops: heardWords.map((h) => ({ type: "ins", heard: h })), start: cursor, end: cursor - 1 };
  const core = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0 && B[i][j] !== 0) {
    const b = B[i][j];
    if (b === 1) { core.push({ type: "match", ref: lo + j - 1, heard: heardWords[i - 1], hi: i - 1, sim: simAt(i - 1, j - 1) }); i--; j--; }
    else if (b === 2) { core.push({ type: "ins", heard: heardWords[i - 1], hi: i - 1 }); i--; }
    else { core.push({ type: "skip", ref: lo + j - 1 }); j--; }
  }
  core.reverse();
  const ops = [];
  for (let k = 0; k < i; k++) ops.push({ type: "ins", heard: heardWords[k], hi: k });
  ops.push(...core);
  for (let k = bi; k < m; k++) ops.push({ type: "ins", heard: heardWords[k], hi: k });
  const matches = core.filter((o) => o.type === "match");
  return { ops, start: matches[0].ref, end: matches[matches.length - 1].ref };
}

export class GuidedSession {
  constructor(text, nativeLangs) {
    this.text = text;
    this.nativeLangs = nativeLangs;
    this.tokens = tokenizeWithSpans(text);
    this.hasDigits = this.tokens.some((t) => /\d/.test(t.word));
    this.words = this.tokens.map((t, idx) => ({
      idx,
      word: t.word,
      surface: t.surface,
      attempts: [],
      prothesis: false,
      patterns: patternsInWord(t.word, nativeLangs),
    }));
    this.refWords = this.words.map((w) => w.word);
    this.cursor = 0;
    this.maxReached = -1;
    this.phrases = [];
  }

  heardTokens(text) {
    return this.hasDigits ? (text.match(/[^\s]+/g) || []).map(normalizeWord).filter(Boolean) : tokenize(text);
  }

  /** Feed one final recognition result. Returns the ref indices that were updated. */
  addPhrase(text, confidence = 0, time = Date.now()) {
    this.phrases.push({ text, confidence, time });
    return this._alignTokens(this.heardTokens(text), confidence, time, 0);
  }

  _alignTokens(heard, confidence, time, depth) {
    if (!heard.length) return [];
    // repetitions inside one phrase ("o pagodzie o pogodzie") become several
    // attempts of the same words before aligning
    const events = collapseRepetitions(heard.map((w) => ({ word: w })));
    const finals = events.map((e) => e.word);
    const { ops, end } = alignPhrase(this.refWords, finals, this.cursor);
    const touched = [];
    let lastIns = null;
    let trailing = [];
    for (const op of ops) {
      if (op.type === "match") {
        const w = this.words[op.ref];
        if (lastIns && /^(w|ł|u)$/.test(lastIns) && /^[ou]/.test(w.word)) w.prothesis = true;
        for (const a of events[op.hi].attempts) {
          w.attempts.push({ heard: a.word, sim: wordSimilarity(a.word, w.word), conf: confidence, time });
        }
        touched.push(op.ref);
        lastIns = null;
        trailing = [];
      } else if (op.type === "skip") {
        const w = this.words[op.ref];
        if (!w.attempts.length) w.attempts.push({ heard: "", sim: 0, conf: confidence, time, missed: true });
        touched.push(op.ref);
        lastIns = null;
      } else {
        lastIns = op.heard;
        if (touched.length) trailing.push(...events[op.hi].attempts.map((a) => a.word));
      }
    }
    if (end >= 0 && touched.length) {
      this.cursor = end + 1;
      this.maxReached = Math.max(this.maxReached, end);
    }
    // the reader jumped back (repeating an earlier part) in the middle of a phrase
    if (trailing.length >= 2 && depth < 3) touched.push(...this._alignTokens(trailing, confidence, time, depth + 1));
    return touched;
  }

  wordStatus(w) {
    if (!w.attempts.length) return w.idx > this.maxReached ? "unread" : "missed";
    const real = w.attempts.filter((a) => !a.missed);
    if (!real.length) return "missed";
    const last = real[real.length - 1];
    if (last.sim >= GOOD) return real.length > 1 && real[0].sim < GOOD ? "fixed" : "good";
    if (last.sim >= CLOSE) return "close";
    return "bad";
  }

  /** Builds the report. */
  report(extra = {}) {
    const read = this.words.filter((w) => w.idx <= this.maxReached);
    const items = read.map((w) => {
      const real = w.attempts.filter((a) => !a.missed);
      return {
        word: w.word,
        surface: w.surface,
        attempts: real.map((a) => ({ heard: a.heard, sim: a.sim })),
        missed: !real.length,
        prothesis: w.prothesis,
        patterns: w.patterns,
      };
    });
    return buildReport(items, this.nativeLangs, { mode: "guided", ...extra });
  }
}

// ---------------------------------------------------------------------------
// Free reading (no reference text)
// ---------------------------------------------------------------------------

/**
 * Collapses a stream of heard words into reading events, merging repetitions:
 * "w domu było w domu było cicho" → [w, domu, było, cicho] with 2 attempts each
 * for the first three. Near-identical repeats (kat → kot) count as self-corrections.
 */
export function collapseRepetitions(tokens, threshold = 0.6) {
  const out = [];
  for (const tok of tokens) {
    out.push({ word: tok.word, attempts: [tok] });
    for (let n = 1; n <= 5; n++) {
      if (out.length < 2 * n) break;
      const a = out.slice(out.length - 2 * n, out.length - n);
      const b = out.slice(out.length - n);
      let ok = true;
      for (let k = 0; k < n; k++) {
        if (wordSimilarity(a[k].word, b[k].word) < threshold) { ok = false; break; }
      }
      // a single-letter word repeated alone ("i i") is fine, but avoid merging
      // n=1 when both are very short different words
      if (ok) {
        for (let k = 0; k < n; k++) {
          a[k].attempts.push(...b[k].attempts);
          a[k].word = b[k].word;
        }
        out.splice(out.length - n, n);
        break;
      }
    }
  }
  return out;
}

export function analyzeFree(phrases, nativeLangs, extra = {}) {
  const tokens = [];
  for (const ph of phrases) {
    for (const w of tokenize(ph.text)) tokens.push({ word: w, conf: ph.confidence || 0 });
  }
  const events = collapseRepetitions(tokens);
  const items = events.map((ev) => {
    const final = ev.word;
    return {
      word: final,
      surface: final,
      attempts: ev.attempts.map((a) => ({ heard: a.word, sim: wordSimilarity(final, a.word), conf: a.conf })),
      missed: false,
      prothesis: false,
      patterns: patternsInWord(final, nativeLangs),
      lowConfidence: ev.attempts.every((a) => a.conf > 0 && a.conf < 0.55),
    };
  });
  const confs = phrases.map((p) => p.confidence).filter((c) => c > 0);
  const clarity = confs.length ? Math.round(100 * confs.reduce((a, b) => a + b, 0) / confs.length) : null;
  return buildReport(items, nativeLangs, { mode: "free", clarity, ...extra });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function wordScore(item) {
  if (item.missed || !item.attempts.length) return 0;
  const last = item.attempts[item.attempts.length - 1].sim;
  if (last >= GOOD) return 1;
  if (last >= CLOSE) return last * 0.85;
  return last * 0.5;
}

export function buildReport(items, nativeLangs, extra = {}) {
  const mode = extra.mode || "guided";
  const patternStats = {};
  const stat = (id) => (patternStats[id] ||= { opp: 0, err: 0, sus: 0, examples: [] });
  const struggle = [];
  let syllables = 0;

  for (const it of items) {
    syllables += syllableCount(it.word) * Math.max(1, it.attempts.length);
    for (const id of it.patterns) stat(id).opp += 1;
    if (it.missed) continue;
    const wrong = new Map(); // patternId -> example
    if (it.prothesis) wrong.set("prothesis", { word: it.word, heard: "w " + it.word, from: "", to: "w" });
    const target = it.word;
    for (const a of it.attempts) {
      if (a.sim >= GOOD) continue;
      if (a.sim < 0.45) { if (!wrong.has("clarity")) wrong.set("clarity", { word: target, heard: a.heard }); continue; }
      for (const d of diagnose(target, a.heard)) {
        if (!wrong.has(d.id)) wrong.set(d.id, { word: target, heard: a.heard, from: d.from, to: d.to });
      }
    }
    for (const [id, ex] of wrong) {
      const s = stat(id);
      s.err += 1;
      if (id !== "clarity" && !it.patterns.includes(id)) s.opp += 1;
      if (s.examples.length < 4) s.examples.push(ex);
    }
    const repeated = it.attempts.length > 1;
    if (repeated && !wrong.size && it.patterns.length) {
      for (const id of it.patterns) stat(id).sus += 1 / it.patterns.length;
    }
    if (repeated || wrong.size || it.lowConfidence) {
      const last = it.attempts[it.attempts.length - 1];
      struggle.push({
        word: it.word,
        surface: it.surface,
        attempts: it.attempts.length,
        heard: [...new Set(it.attempts.map((a) => a.heard).filter((h) => h && h !== it.word))],
        fixed: last && last.sim >= GOOD,
        patterns: [...new Set([...wrong.keys()].filter((k) => k !== "clarity").concat(it.patterns))],
        diagnosed: [...wrong.keys()],
        lowConfidence: !!it.lowConfidence,
      });
    }
  }

  const read = items.filter((i) => !i.missed || mode === "guided");
  const wordsRead = items.length;
  let accuracy = null, firstTry = null;
  if (mode === "guided" && wordsRead) {
    accuracy = Math.round(100 * items.reduce((s, it) => s + wordScore(it), 0) / wordsRead);
    firstTry = Math.round(100 * items.filter((it) => !it.missed && it.attempts[0] && it.attempts[0].sim >= GOOD).length / wordsRead);
  } else if (mode === "free" && wordsRead) {
    // share of words read cleanly on the first go (no self-correction / low confidence)
    firstTry = Math.round(100 * items.filter((it) => it.attempts.length === 1 && !it.lowConfidence).length / wordsRead);
  }

  struggle.sort((a, b) => (b.diagnosed.length - a.diagnosed.length) || (b.attempts - a.attempts));
  const report = {
    id: extra.id || `s${Date.now().toString(36)}`,
    date: extra.date || new Date().toISOString(),
    mode,
    title: extra.title || (mode === "guided" ? "Reading" : "Free reading"),
    durationSec: extra.durationSec || 0,
    nativeLangs,
    wordsRead,
    repeats: items.reduce((s, it) => s + Math.max(0, it.attempts.length - 1), 0),
    syllables,
    accuracy,
    firstTry,
    clarity: extra.clarity ?? null,
    fluency: extra.fluency || null,
    patternStats,
    struggleWords: struggle.slice(0, 40),
    words: mode === "guided" ? items.map((it) => ({ w: it.surface, s: it.missed ? "missed" : statusOf(it) })) : undefined,
  };
  report.overall = overallScore(report);
  report.recommendations = recommend(patternStats, nativeLangs);
  return report;
}

function statusOf(it) {
  const real = it.attempts;
  const last = real[real.length - 1];
  if (!last) return "missed";
  if (last.sim >= GOOD) return real.length > 1 && real[0].sim < GOOD ? "fixed" : real.length > 1 ? "repeated" : "good";
  if (last.sim >= CLOSE) return "close";
  return "bad";
}

export function overallScore(r) {
  const parts = [];
  if (r.accuracy != null) parts.push([r.accuracy, 0.55]);
  if (r.firstTry != null) parts.push([r.firstTry, r.mode === "guided" ? 0.2 : 0.3]);
  if (r.clarity != null) parts.push([r.clarity, 0.3]);
  if (r.fluency && r.fluency.score != null) parts.push([r.fluency.score, 0.25]);
  if (!parts.length) return null;
  const wsum = parts.reduce((s, p) => s + p[1], 0);
  return Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / wsum);
}

/**
 * Ranks accent patterns to work on. Observed errors dominate; with little data
 * the native-language prior fills in (Bayesian smoothing).
 */
export function recommend(patternStats, nativeLangs, limit = 4) {
  const K = 6;
  const rows = [];
  for (const p of relevantPatterns(nativeLangs)) {
    const s = patternStats[p.id] || { opp: 0, err: 0, sus: 0, examples: [] };
    const prior = 0.06 * severityFor(p, nativeLangs);
    const observed = s.err + 0.5 * s.sus;
    const rate = (observed + prior * K) / (s.opp + K);
    rows.push({ id: p.id, rate, opp: s.opp, err: s.err, sus: s.sus, examples: s.examples, measured: s.opp >= 3 || s.err > 0 });
  }
  rows.sort((a, b) => b.rate - a.rate);
  return rows.slice(0, limit).map((r) => ({ ...r, reason: reasonText(r, nativeLangs) }));
}

function reasonText(r, nativeLangs) {
  const p = PATTERN_BY_ID[r.id];
  const langs = nativeLangs.filter((l) => (p.severity[l] ?? 0) >= 2).map((l) => (l === "be" ? "Belarusian" : "Russian"));
  if (r.err > 0) {
    const ex = r.examples[0];
    const exText = ex ? ` (e.g. “${ex.word}” was heard as “${ex.heard}”)` : "";
    return `${Math.round(r.err)} of ${r.opp} word${r.opp === 1 ? "" : "s"} with this sound ${r.err === 1 ? "was" : "were"} misheard${exText}.`;
  }
  if (r.sus >= 0.5) return `Words with this sound often needed a second try while reading.`;
  if (langs.length) return `Typical for ${langs.join(" and ")} speakers${r.opp ? ` — no problems detected in ${r.opp} word${r.opp === 1 ? "" : "s"} yet` : ""}.`;
  return `Worth checking.`;
}

export { GOOD, CLOSE };
