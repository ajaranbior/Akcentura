// Microphone analysis: loudness, voice activity, pitch (melody), vowel formants,
// and the fluency summary of a reading (pace, pauses, melody, sentence endings).
// Pure DSP functions are exported for testing.

export function downsample(buf, factor) {
  if (factor <= 1) return Float32Array.from(buf);
  const n = Math.floor(buf.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += buf[i * factor + k];
    out[i] = s / factor;
  }
  return out;
}

export function rmsDb(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const rms = Math.sqrt(s / buf.length);
  return 20 * Math.log10(rms + 1e-9);
}

/** McLeod pitch method on a (downsampled) buffer. Returns {f0, clarity} or null. */
export function detectPitch(x, fs, fmin = 70, fmax = 420) {
  const n = x.length;
  const minLag = Math.max(2, Math.floor(fs / fmax));
  const maxLag = Math.min(n - 2, Math.ceil(fs / fmin));
  const nsdf = new Float32Array(maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i + tau < n; i++) {
      acf += x[i] * x[i + tau];
      m += x[i] * x[i] + x[i + tau] * x[i + tau];
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  // collect key maxima between positive zero crossings
  const peaks = [];
  let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++; // skip the first lobe
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    let best = -1, bestTau = -1;
    while (tau <= maxLag && nsdf[tau] > 0) {
      if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; }
      tau++;
    }
    if (bestTau > 0) peaks.push([bestTau, best]);
  }
  const valid = peaks.filter(([t]) => t >= minLag);
  if (!valid.length) return null;
  const maxPeak = Math.max(...valid.map((p) => p[1]));
  const chosen = valid.find((p) => p[1] >= 0.85 * maxPeak);
  const [t0, clarity] = chosen;
  // parabolic interpolation
  const a = nsdf[t0 - 1], b = nsdf[t0], c = nsdf[t0 + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const f0 = fs / (t0 + shift);
  if (f0 < fmin || f0 > fmax) return null;
  return { f0, clarity };
}

/** LPC coefficients via autocorrelation + Levinson–Durbin. Returns a[0..p] with a[0]=1. */
export function lpc(x, order) {
  const n = x.length;
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += x[i] * x[i + k];
    r[k] = s;
  }
  if (r[0] <= 0) return null;
  r[0] *= 1.0001; // light regularisation
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) return null;
  }
  return a;
}

/** Roots of z^p + a1 z^(p-1) + … + ap (Durand–Kerner). Returns [[re, im], …]. */
export function polyRoots(a) {
  const p = a.length - 1;
  const roots = [];
  for (let k = 0; k < p; k++) {
    const ang = (2 * Math.PI * k) / p + 0.4;
    roots.push([0.9 * Math.cos(ang), 0.9 * Math.sin(ang)]);
  }
  const evalP = (re, im) => {
    let pr = 1, pi = 0;
    for (let k = 1; k <= p; k++) {
      const nr = pr * re - pi * im + a[k];
      const ni = pr * im + pi * re;
      pr = nr; pi = ni;
    }
    return [pr, pi];
  };
  for (let iter = 0; iter < 300; iter++) {
    let maxDelta = 0;
    for (let k = 0; k < p; k++) {
      const [zr, zi] = roots[k];
      const [nr, ni] = evalP(zr, zi);
      let dr = 1, di = 0;
      for (let j = 0; j < p; j++) {
        if (j === k) continue;
        const xr = zr - roots[j][0], xi = zi - roots[j][1];
        const tr = dr * xr - di * xi;
        di = dr * xi + di * xr;
        dr = tr;
      }
      const den = dr * dr + di * di || 1e-12;
      const qr = (nr * dr + ni * di) / den;
      const qi = (ni * dr - nr * di) / den;
      roots[k] = [zr - qr, zi - qi];
      maxDelta = Math.max(maxDelta, Math.abs(qr) + Math.abs(qi));
    }
    if (maxDelta < 1e-10) break;
  }
  return roots;
}

/** First two formants (Hz) of a voiced frame, or null. `x` should be at ~10–12 kHz. */
export function estimateFormants(x, fs, order = 12) {
  const n = x.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pre = x[i] - (i ? 0.97 * x[i - 1] : 0);
    y[i] = pre * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  const a = lpc(y, order);
  if (!a) return null;
  const cands = [];
  for (const [re, im] of polyRoots(a)) {
    if (im <= 0.001) continue;
    const mag = Math.hypot(re, im);
    const f = (Math.atan2(im, re) * fs) / (2 * Math.PI);
    const bw = (-fs / Math.PI) * Math.log(mag);
    if (f > 150 && f < fs / 2 - 100 && bw > 0 && bw < 600) cands.push(f);
  }
  cands.sort((p, q) => p - q);
  const f1 = cands.find((f) => f >= 180 && f <= 1300);
  if (f1 === undefined) return null;
  const f2 = cands.find((f) => f > f1 + 150 && f <= 3300);
  if (f2 === undefined) return null;
  return { f1, f2 };
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Frame indices of energy peaks ≈ syllable nuclei. */
export function syllablePeaks(frames, dt = 0.02) {
  const db = frames.map((f) => f.db);
  const sm = db.map((_, i) => (db[Math.max(0, i - 1)] + db[i] + db[Math.min(db.length - 1, i + 1)]) / 3);
  const peaks = [];
  const w = Math.max(2, Math.round(0.12 / dt));
  for (let i = 1; i < sm.length - 1; i++) {
    if (!frames[i].speech) continue;
    if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1]) {
      // prominence: drop of ≥2.5 dB on both sides within 120 ms
      let lmin = sm[i], rmin = sm[i];
      for (let k = 1; k <= w; k++) {
        if (i - k >= 0) lmin = Math.min(lmin, sm[i - k]);
        if (i + k < sm.length) rmin = Math.min(rmin, sm[i + k]);
      }
      const last = peaks[peaks.length - 1];
      if (sm[i] - lmin >= 2.5 && sm[i] - rmin >= 2.5 && (last === undefined || frames[i].t - frames[last].t >= 0.09)) peaks.push(i);
    }
  }
  return peaks;
}

const STRETCH_RATIO = 1.75; // a syllable this many times longer than your typical one is "drawn out"
const NATURAL_STRETCH_SHARE = 0.05; // some longer syllables happen in any natural reading

/**
 * Syllable evenness ("przeciąganie"). A syllable runs from the energy dip before its
 * peak to the dip after it, so a drawn-out vowel makes its own syllable long. Peaks
 * separated by silence belong to different phrases; the first syllable of a phrase
 * (no dip before it) and the last one (slowing down before a pause is natural) are
 * left out. Returns null without enough syllables.
 *  - stretched: syllables ≥ STRETCH_RATIO × the median length (and ≥ 120 ms longer)
 *  - excess:    stretched beyond what a natural reading has
 *  - evenness:  0–100 (100 = metronome-even)
 *  - phrases:   per phrase, each syllable's length relative to the median (for display)
 */
export function analyzeRhythm(frames, peakIdx = null) {
  if (frames.length < 10) return null;
  const dt = (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) || 0.02;
  const peaks = peakIdx || syllablePeaks(frames, dt);
  const db = frames.map((f) => f.db);
  const sm = db.map((_, i) => (db[Math.max(0, i - 1)] + db[i] + db[Math.min(db.length - 1, i + 1)]) / 3);
  // group peaks into phrases, with the valley between consecutive peaks
  const groups = [];
  let g = peaks.length ? { peaks: [peaks[0]], valleys: [] } : null;
  for (let k = 1; k < peaks.length; k++) {
    const a = peaks[k - 1], b = peaks[k];
    let silent = 0, v = a;
    for (let i = a; i <= b; i++) {
      if (!frames[i].speech) silent++;
      if (sm[i] < sm[v]) v = i;
    }
    if (frames[b].t - frames[a].t >= 0.8 || silent * dt >= 0.1) {
      groups.push(g);
      g = { peaks: [b], valleys: [] };
    } else {
      g.peaks.push(b);
      g.valleys.push(v);
    }
  }
  if (g) groups.push(g);
  const phrases = [];
  for (const gr of groups) {
    // syllable j (1..n-2) spans valleys[j-1] .. valleys[j]
    const ph = [];
    for (let j = 1; j < gr.valleys.length; j++) ph.push(frames[gr.valleys[j]].t - frames[gr.valleys[j - 1]].t);
    if (ph.length) phrases.push(ph);
  }
  const all = phrases.flat();
  if (all.length < 6) return null;
  const med = median(all);
  const isLong = (d) => d >= STRETCH_RATIO * med && d - med >= 0.12;
  const stretched = all.filter(isLong).length;
  let s = 0, n = 0;
  for (const ph of phrases) {
    for (let i = 1; i < ph.length; i++) { s += Math.abs(ph[i] - ph[i - 1]) / ((ph[i] + ph[i - 1]) / 2); n++; }
  }
  const npvi = n ? (100 * s) / n : null;
  const share = stretched / all.length;
  const excess = Math.max(0, stretched - Math.round(NATURAL_STRETCH_SHARE * all.length));
  const evenStretch = clamp01(1 - (share - NATURAL_STRETCH_SHARE) / 0.15);
  const evenPvi = npvi != null ? clamp01(1 - (npvi - 40) / 35) : evenStretch;
  return {
    intervals: all.length,
    median: Math.round(med * 1000),
    stretched,
    excess,
    share: Math.round(share * 1000) / 1000,
    npvi: npvi != null ? Math.round(npvi) : null,
    evenness: Math.round(100 * (0.65 * evenStretch + 0.35 * evenPvi)),
    phrases: phrases.slice(0, 8).map((ph) => ph.slice(0, 30).map((d) => Math.round((d / med) * 100) / 100)),
    stretchRatio: STRETCH_RATIO,
  };
}

/**
 * Summarises frames [{t, db, speech, f0}] (t in seconds) into fluency metrics.
 * `textSyllables` (from the recognised text) gives a more reliable pace if available.
 */
export function computeFluency(frames, textSyllables = 0) {
  if (frames.length < 10) return null;
  const dt = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 0.02;
  // speech runs: merge speech frames separated by < 250 ms
  const runs = [];
  let cur = null;
  for (const f of frames) {
    if (f.speech) {
      if (cur && f.t - cur.end <= 0.25) cur.end = f.t;
      else { cur = { start: f.t, end: f.t }; runs.push(cur); }
    }
  }
  const realRuns = runs.filter((r) => r.end - r.start >= 0.12);
  if (!realRuns.length) return null;
  const speakingTime = realRuns.reduce((s, r) => s + (r.end - r.start + dt), 0);
  if (speakingTime < 3) return { speakingTime, tooShort: true, score: null };
  let hesitations = 0, longPauses = 0;
  for (let i = 1; i < realRuns.length; i++) {
    const gap = realRuns[i].start - realRuns[i - 1].end;
    if (gap > 2.0) longPauses++;
    else if (gap >= 0.25) hesitations++;
  }
  const minutes = speakingTime / 60;

  const peakIdx = syllablePeaks(frames, dt);
  const rate = textSyllables > 0 ? textSyllables / speakingTime : peakIdx.length / speakingTime;
  const rhythm = analyzeRhythm(frames, peakIdx);
  const npvi = rhythm ? rhythm.npvi : null;

  // melody: pitch spread in semitones (5–95 percentile, robust to octave errors)
  const st = frames.filter((f) => f.f0).map((f) => 12 * Math.log2(f.f0 / 100));
  let pitchRange = null, pitchStd = null;
  if (st.length >= 20) {
    const lo = percentile(st, 0.05), hi = percentile(st, 0.95);
    pitchRange = hi - lo;
    const trimmed = st.filter((v) => v >= lo && v <= hi);
    const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    pitchStd = Math.sqrt(trimmed.reduce((a, b) => a + (b - mean) ** 2, 0) / trimmed.length);
  }

  // sentence endings: does loudness fade at the end of longer runs?
  let longRuns = 0, fading = 0;
  for (const r of realRuns) {
    if (r.end - r.start < 0.8) continue;
    const inRun = frames.filter((f) => f.t >= r.start && f.t <= r.end && f.speech);
    if (inRun.length < 10) continue;
    longRuns++;
    const cut1 = Math.floor(inRun.length * 0.6), cut2 = Math.floor(inRun.length * 0.8);
    const head = median(inRun.slice(0, cut1).map((f) => f.db));
    const tail = median(inRun.slice(cut2).map((f) => f.db));
    if (head - tail > 7) fading++;
  }
  const trailing = longRuns ? fading / longRuns : null;

  const hesitationRate = minutes > 0 ? hesitations / minutes : 0;
  const parts = [];
  parts.push([clamp01((rate - 2.3) / (4.6 - 2.3)), 0.3]);
  parts.push([clamp01(1 - (hesitationRate - 8) / 22), 0.25]);
  if (pitchStd != null) parts.push([clamp01((pitchStd - 1.0) / (2.6 - 1.0)), 0.25]);
  if (trailing != null) parts.push([clamp01(1 - trailing * 1.5), 0.2]);
  if (rhythm && rhythm.evenness != null) parts.push([rhythm.evenness / 100, 0.2]);
  const wsum = parts.reduce((s, p) => s + p[1], 0);
  const score = Math.round((100 * parts.reduce((s, p) => s + p[0] * p[1], 0)) / wsum);

  return {
    speakingTime: Math.round(speakingTime * 10) / 10,
    rate: Math.round(rate * 10) / 10,
    rateSource: textSyllables > 0 ? "text" : "audio",
    hesitations,
    hesitationRate: Math.round(hesitationRate * 10) / 10,
    longPauses,
    pitchStd: pitchStd != null ? Math.round(pitchStd * 10) / 10 : null,
    pitchRange: pitchRange != null ? Math.round(pitchRange * 10) / 10 : null,
    trailing: trailing != null ? Math.round(trailing * 100) / 100 : null,
    npvi: npvi != null ? Math.round(npvi) : null,
    rhythm,
    score,
  };
}

/** Live microphone analyser. */
export class AudioAnalyzer {
  constructor({ formants = false, onFrame = null } = {}) {
    this.formants = formants;
    this.onFrame = onFrame;
    this.frames = [];
    this.running = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.fs = this.ctx.sampleRate;
    this.factor = Math.max(1, Math.round(this.fs / 11025));
    this.dfs = this.fs / this.factor;
    this.t0 = performance.now();
    this.noise = -60;
    this.hang = 0;
    this.frames = [];
    this.running = true;
    this.timer = setInterval(() => this.tick(), 20);
  }

  tick() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const t = (performance.now() - this.t0) / 1000;
    const db = rmsDb(this.buf);
    // adaptive noise floor: falls fast, rises slowly
    if (db < this.noise) this.noise = db;
    else this.noise += 0.01;
    const thr = Math.max(this.noise + 12, -58);
    let speech = db > thr;
    if (speech) this.hang = 8;
    else if (this.hang > 0) { this.hang--; speech = db > this.noise + 6; }
    let f0 = null, clarity = 0, fm = null;
    if (db > thr) {
      const x = downsample(this.buf, this.factor);
      const p = detectPitch(x, this.dfs);
      if (p && p.clarity > 0.6) { f0 = p.f0; clarity = p.clarity; }
      if (this.formants && f0) fm = estimateFormants(x.subarray(Math.max(0, x.length - 400)), this.dfs);
    }
    const frame = { t, db, speech, f0 };
    this.frames.push(frame);
    if (this.frames.length > 60 * 60 * 50) this.frames.shift(); // cap at one hour
    if (this.onFrame) this.onFrame({ ...frame, clarity, noise: this.noise, formants: fm });
  }

  summary(textSyllables = 0) {
    return computeFluency(this.frames, textSyllables);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    try { this.source && this.source.disconnect(); } catch { /* ignore */ }
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    if (this.ctx && this.ctx.state !== "closed") this.ctx.close().catch(() => {});
  }
}
