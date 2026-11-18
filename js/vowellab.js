// Vowel lab: live F1/F2 chart of your vowels against the Polish vowel targets.
// Calibrating with i, a, u maps the Polish targets onto *your* vocal tract,
// so the o target is where a Polish o would be for your voice — not where
// your habitual (narrower) Russian/Belarusian o lands.

import { AudioAnalyzer, syllablePeaks } from "./audio.js";
import { getState, setVowelCalibration } from "./storage.js";
import { g2p, normalizeWord } from "./polish.js";

// Approximate Polish vowel formants (Hz), after Jassem's measurements.
export const POLISH_VOWELS = {
  male: { i: [300, 2250], y: [380, 1700], e: [540, 1750], a: [720, 1320], o: [520, 950], u: [330, 800] },
  female: { i: [350, 2700], y: [440, 2000], e: [620, 2100], a: [880, 1550], o: [590, 1080], u: [380, 900] },
};
const ORDER = ["i", "y", "e", "a", "o", "u"];
const EXAMPLES = { i: "bić, miły", y: "być, ryba", e: "ten, sen", a: "tam, mama", o: "kot, dom", u: "but, góra" };

/** Polish targets mapped onto the speaker's own corner vowels. */
export function personalTargets(voiceType, cal) {
  const ref = POLISH_VOWELS[voiceType] || POLISH_VOWELS.male;
  if (!cal || !cal.i || !cal.a || !cal.u) return { ...ref };
  const rLo = (ref.i[0] + ref.u[0]) / 2, rA = ref.a[0];
  const uLo = (cal.i[0] + cal.u[0]) / 2, uA = cal.a[0];
  const out = {};
  for (const v of ORDER) {
    const t1 = (ref[v][0] - rLo) / (rA - rLo);
    const t2 = (ref[v][1] - ref.u[1]) / (ref.i[1] - ref.u[1]);
    out[v] = [uLo + t1 * (uA - uLo), cal.u[1] + t2 * (cal.i[1] - cal.u[1])];
  }
  return out;
}

// IPA of the Polish vowels
export const VOWEL_IPA = { i: "i", y: "ɨ", e: "ɛ", a: "a", o: "ɔ", u: "u" };

/**
 * Polish targets plus the non-Polish vowels a Belarusian/Russian accent tends to use,
 * placed relative to the speaker's own Polish targets:
 *  o  close-mid [o] (stressed Russian/Belarusian о — narrower than Polish ɔ)
 *  ɐ  reduced unstressed о/а (akanie: молоко, вада)
 *  ə  vague reduced vowel (unstressed endings)
 *  e  close-mid [e] (Russian stressed е — narrower than Polish ɛ)
 */
export function ipaTargets(targets) {
  const t = targets;
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  return [
    ...ORDER.map((v) => ({ ipa: VOWEL_IPA[v], polish: true, v, f: t[v] })),
    { ipa: "o", polish: false, f: mix(t.o, t.u, 0.45), note: "narrow Russian/Belarusian о" },
    { ipa: "ɐ", polish: false, f: [(t.o[0] + t.a[0]) / 2 * 1.02, (t.a[1] + t.o[1]) / 2 * 1.08], note: "reduced о/а (akanie)" },
    { ipa: "ə", polish: false, f: [(t.e[0] + t.o[0]) / 2 * 0.95, (t.e[1] + t.o[1]) / 2], note: "vague reduced vowel" },
    { ipa: "e", polish: false, f: mix(t.e, t.i, 0.4), note: "narrow Russian е" },
  ];
}

export function classifyIpa(f1, f2, targets) {
  let best = null, bd = Infinity;
  for (const c of ipaTargets(targets)) {
    const d = Math.hypot(Math.log(f1 / c.f[0]) * 1.2, Math.log(f2 / c.f[1]));
    if (d < bd) { bd = d; best = c; }
  }
  return { ...best, distance: bd };
}

const WORD_SETS = {
  o: ["woda", "pogoda", "dobrota", "kolor", "robota", "samochód", "ogród", "potem", "pomoc", "obok"],
};

export function classifyVowel(f1, f2, targets) {
  let best = null, bd = Infinity;
  for (const v of ORDER) {
    const [t1, t2] = targets[v];
    const d = Math.hypot(Math.log(f1 / t1) * 1.2, Math.log(f2 / t2));
    if (d < bd) { bd = d; best = v; }
  }
  return { vowel: best, distance: bd };
}

export function mountVowelLab(root, { toast }) {
  const st = getState();
  let target = "o";
  let analyzer = null;
  let trail = [];
  let seg = [];
  let silent = 0;
  let tally = [];
  let calibrating = null;

  root.innerHTML = `
    <div class="row between"><h3 style="margin:0">Vowel lab</h3><span class="badge" id="vlCal"></span></div>
    <p class="small muted">Hold a vowel or say short words. The dot shows where your vowel lands; the circles are Polish vowels${st.vowelCalibration ? " adjusted to your voice" : ""}. Best in a quiet room.</p>
    <canvas class="vowel-canvas" id="vlCanvas"></canvas>
    <div class="vowel-buttons" id="vlTargets" style="margin-top:10px"></div>
    <div id="vlResult" class="small" style="margin-top:8px;min-height:1.5em"></div>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" id="vlStart" type="button">Start listening</button>
      <button class="btn" id="vlCalibrate" type="button">Calibrate (i · a · u)</button>
    </div>
    <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
      <h3 style="margin:0 0 4px">Word check (IPA per syllable)</h3>
      <p class="small muted">Say one word; every syllable’s vowel is measured and written in IPA next to the Polish target — e.g. whether the o after the first syllable stays a full [ɔ] or turns into [ɐ]/[o]. Calibrate first for best results.</p>
      <div class="row" style="align-items:center"><select id="vlWord" style="width:auto">${WORD_SETS.o.map((w) => `<option>${w}</option>`).join("")}</select>
        <input id="vlWordCustom" placeholder="or type a word" style="flex:1;min-width:120px">
        <button class="btn small primary" id="vlWordRec" type="button">Record word</button></div>
      <div id="vlWordOut" style="margin-top:10px"></div>
    </div>`;

  const canvas = root.querySelector("#vlCanvas");
  const ctx = canvas.getContext("2d");
  const calBadge = root.querySelector("#vlCal");
  const resultEl = root.querySelector("#vlResult");
  const targetsEl = root.querySelector("#vlTargets");

  const voiceType = () => getState().settings.voiceType || "male";
  const targets = () => personalTargets(voiceType(), getState().vowelCalibration);
  const updateBadge = () => { calBadge.textContent = getState().vowelCalibration ? "calibrated" : "not calibrated"; };
  updateBadge();

  targetsEl.innerHTML = ORDER.map((v) => `<button type="button" data-v="${v}" class="${v === target ? "on" : ""}" title="${EXAMPLES[v]}">${v}</button>`).join("");
  targetsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    target = b.dataset.v;
    tally = [];
    targetsEl.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === target));
    resultEl.textContent = `Target: Polish “${target}” as in ${EXAMPLES[target]}.`;
    draw();
  });

  function bounds() {
    const female = voiceType() === "female";
    const t = targets();
    const f1s = ORDER.map((v) => t[v][0]), f2s = ORDER.map((v) => t[v][1]);
    return {
      f1min: Math.min(200, ...f1s) - 30, f1max: Math.max(female ? 1050 : 900, ...f1s) + 80,
      f2min: Math.min(600, ...f2s) - 150, f2max: Math.max(female ? 2900 : 2500, ...f2s) + 150,
    };
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"; }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const b = bounds();
    // x: F2 high on the left (front vowels), y: F1 low at the top (close vowels), log scales
    const X = (f2) => 16 + (1 - Math.log(f2 / b.f2min) / Math.log(b.f2max / b.f2min)) * (w - 32);
    const Y = (f1) => 16 + (Math.log(f1 / b.f1min) / Math.log(b.f1max / b.f1min)) * (h - 32);
    ctx.font = "11px system-ui";
    ctx.fillStyle = css("--muted");
    ctx.fillText("front ← tongue → back", 12, h - 6);
    ctx.save(); ctx.translate(w - 6, 16); ctx.rotate(Math.PI / 2); ctx.fillText("close ← jaw → open", 0, 0); ctx.restore();
    const t = targets();
    for (const v of ORDER) {
      const [f1, f2] = t[v];
      const on = v === target;
      ctx.beginPath();
      ctx.arc(X(f2), Y(f1), on ? 30 : 24, 0, Math.PI * 2);
      ctx.fillStyle = on ? css("--accent-soft") : css("--surface");
      ctx.fill();
      ctx.lineWidth = on ? 2 : 1;
      ctx.strokeStyle = on ? css("--accent") : css("--border");
      ctx.stroke();
      ctx.fillStyle = on ? css("--accent") : css("--text-2");
      ctx.font = "bold 18px Georgia, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(VOWEL_IPA[v], X(f2), Y(f1));
    }
    // non-Polish reference vowels (dashed): where an Eastern Slavic accent lands
    for (const c of ipaTargets(t).filter((x) => !x.polish && (target === "o" ? ["o", "ɐ"].includes(x.ipa) : target === "e" ? ["e", "ə"].includes(x.ipa) : false))) {
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.arc(X(c.f[1]), Y(c.f[0]), 16, 0, Math.PI * 2);
      ctx.strokeStyle = css("--bad");
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css("--bad");
      ctx.font = "15px Georgia, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(c.ipa, X(c.f[1]), Y(c.f[0]));
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    trail.forEach((p, i) => {
      const a = (i + 1) / trail.length;
      ctx.beginPath();
      ctx.arc(X(p[1]), Y(p[0]), i === trail.length - 1 ? 7 : 3.5, 0, Math.PI * 2);
      ctx.globalAlpha = i === trail.length - 1 ? 1 : a * 0.6;
      ctx.fillStyle = css("--chart");
      ctx.fill();
      if (i === trail.length - 1) { ctx.lineWidth = 2; ctx.strokeStyle = css("--surface"); ctx.stroke(); }
    });
    ctx.globalAlpha = 1;
  }

  function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

  let wordRec = null;
  function onFrame(fr) {
    if (wordRec) wordRec.push({ t: fr.t, db: fr.db, speech: fr.speech, fm: fr.formants });
    if (fr.formants) {
      seg.push([fr.formants.f1, fr.formants.f2]);
      silent = 0;
      const last = seg.slice(-5);
      trail.push([median(last.map((p) => p[0])), median(last.map((p) => p[1]))]);
      if (trail.length > 30) trail.shift();
      if (calibrating) calibrating.frames.push([fr.formants.f1, fr.formants.f2]);
    } else if (seg.length) {
      silent++;
      if (silent >= 4) endSegment();
    }
  }

  function endSegment() {
    if (seg.length >= 5 && !calibrating) {
      const mid = seg.slice(Math.floor(seg.length * 0.25), Math.ceil(seg.length * 0.75));
      const f1 = median(mid.map((p) => p[0])), f2 = median(mid.map((p) => p[1]));
      const { vowel } = classifyVowel(f1, f2, targets());
      const ipa = classifyIpa(f1, f2, targets());
      // onset glide: the first part of the vowel much closer/rounder than its middle ([ᵘɔ])
      const head = seg.slice(0, Math.max(2, Math.floor(seg.length * 0.2)));
      const h1 = median(head.map((p) => p[0])), h2 = median(head.map((p) => p[1]));
      const glide = target === "o" && seg.length >= 8 && h1 < f1 * 0.85 && h2 <= f2 * 1.05;
      tally.push(vowel === target);
      if (tally.length > 10) tally.shift();
      const hits = tally.filter(Boolean).length;
      const t = targets()[target];
      let hint = "";
      if (vowel !== target) {
        if (f1 < t[0] * 0.9) hint = " — open your jaw a bit more";
        else if (f1 > t[0] * 1.12) hint = " — close the jaw slightly";
        if (f2 < t[1] * 0.88) hint += hint ? ", tongue more forward" : " — tongue more forward";
        else if (f2 > t[1] * 1.12) hint += hint ? ", tongue further back / round lips" : " — tongue further back / round the lips";
      }
      const tf1 = targets()[target][0];
      const open = target === "o" ? ` Openness: F1 ${Math.round(f1)} Hz vs Polish [ɔ] ${Math.round(tf1)} Hz${f1 < tf1 * 0.92 ? " — too narrow, drop the jaw" : f1 > tf1 * 1.15 ? " — too open (towards a)" : " ✓"}.` : "";
      resultEl.innerHTML = `Last vowel ≈ <b>[${ipa.ipa}]</b>${ipa.polish ? "" : ` <span class="badge bad">not Polish: ${ipa.note}</span>`} ${vowel === target ? "✓" : `(target [${VOWEL_IPA[target]}])${hint}`}.${open}${glide ? ` <b>Starts with a u-glide [ᵘɔ]</b> — begin the o already open.` : ""} On target: <b>${hits}/${tally.length}</b>`;
    }
    seg = [];
    silent = 0;
  }

  let raf = 0;
  const loop = () => { draw(); raf = requestAnimationFrame(loop); };

  async function start() {
    if (analyzer) return;
    analyzer = new AudioAnalyzer({ formants: true, onFrame });
    try {
      await analyzer.start();
    } catch (e) {
      analyzer = null;
      toast("Microphone not available: " + e.message);
      return false;
    }
    root.querySelector("#vlStart").textContent = "Stop";
    loop();
    return true;
  }

  function stop() {
    if (!analyzer) return;
    analyzer.stop();
    analyzer = null;
    cancelAnimationFrame(raf);
    root.querySelector("#vlStart").textContent = "Start listening";
    draw();
  }

  root.querySelector("#vlStart").addEventListener("click", () => (analyzer ? stop() : start()));

  root.querySelector("#vlCalibrate").addEventListener("click", async () => {
    if (!analyzer && !(await start())) return;
    const result = {};
    for (const v of ["i", "a", "u"]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        resultEl.innerHTML = `<b>Calibration:</b> take a breath and hold a long “${v}${v}${v}…” (${EXAMPLES[v]}) for 2 seconds…`;
        await new Promise((r) => setTimeout(r, 900));
        calibrating = { frames: [] };
        await new Promise((r) => setTimeout(r, 2200));
        const fr = calibrating.frames;
        calibrating = null;
        if (fr.length >= 12) {
          result[v] = [median(fr.map((p) => p[0])), median(fr.map((p) => p[1]))];
          break;
        }
        resultEl.textContent = "Didn't catch that — louder and steadier, please.";
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (!result[v]) { resultEl.textContent = "Calibration failed. Try again in a quieter place."; return; }
    }
    if (!(result.a[0] > result.i[0] && result.a[0] > result.u[0] && result.i[1] > result.u[1])) {
      resultEl.textContent = "These measurements look unusual (noise?). Calibration not saved — please try again.";
      return;
    }
    setVowelCalibration(result);
    updateBadge();
    resultEl.textContent = "Calibrated ✓ Targets are now adjusted to your voice.";
    draw();
  });

  const wordBtn = root.querySelector("#vlWordRec");
  const wordOut = root.querySelector("#vlWordOut");
  wordBtn.addEventListener("click", async () => {
    if (wordRec) { finishWord(); return; }
    if (!analyzer && !(await start())) return;
    wordRec = [];
    wordBtn.textContent = "Stop";
    wordOut.innerHTML = `<p class="small muted">Say “${currentWord()}” clearly, then tap Stop.</p>`;
  });
  const currentWord = () => normalizeWord(root.querySelector("#vlWordCustom").value.trim().split(/\s+/)[0] || "") || root.querySelector("#vlWord").value;

  function finishWord() {
    const frames = wordRec;
    wordRec = null;
    wordBtn.textContent = "Record word";
    const word = currentWord();
    const res = measureWord(frames, word, targets());
    if (!res) { wordOut.innerHTML = `<div class="result-banner meh">Couldn’t measure the vowels — say the word a bit louder and slower.</div>`; return; }
    wordOut.innerHTML = renderWordResult(word, res);
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  draw();

  return { stop: () => { wordRec = null; stop(); }, setTarget: (v) => targetsEl.querySelector(`[data-v="${v}"]`)?.click() };
}

/** Expected vowel per syllable of a word (Polish phone ids, nasals by their oral base). */
export function expectedVowels(word) {
  return g2p(word).filter((t) => t.syl !== null).map((t) => ({ v: t.p === "on" ? "o" : t.p === "en" ? "e" : t.p, letters: t.letters }));
}

/**
 * Measures the vowel at each syllable peak of a recorded word.
 * frames: [{t, db, speech, fm:{f1,f2}|null}]. Returns [{expected, ipa, ok}] or null.
 */
export function measureWord(frames, word, targets) {
  if (!frames || frames.length < 10) return null;
  const exp = expectedVowels(word);
  if (!exp.length) return null;
  const peaks = syllablePeaks(frames);
  const nuclei = [];
  for (const i of peaks) {
    const fm = frames.slice(Math.max(0, i - 3), i + 4).map((f) => f.fm).filter(Boolean);
    if (fm.length < 2) continue;
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    nuclei.push({ f1: med(fm.map((f) => f.f1)), f2: med(fm.map((f) => f.f2)), db: frames[i].db });
  }
  if (!nuclei.length) return null;
  // keep the loudest nuclei if more were found than syllables, in time order
  let use = nuclei;
  if (use.length > exp.length) {
    const keep = new Set([...use].sort((a, b) => b.db - a.db).slice(0, exp.length));
    use = use.filter((n) => keep.has(n));
  }
  return {
    countMismatch: use.length !== exp.length,
    syllables: exp.map((e, k) => {
      const n = use[k];
      if (!n) return { expected: e, ipa: null, ok: null };
      const c = classifyIpa(n.f1, n.f2, targets);
      return { expected: e, ipa: c.ipa, polish: c.polish, note: c.note, ok: c.polish && c.v === e.v, f1: Math.round(n.f1), f2: Math.round(n.f2) };
    }),
  };
}

function renderWordResult(word, res) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const target = res.syllables.map((s) => VOWEL_IPA[s.expected.v] || s.expected.v);
  const cells = res.syllables.map((s) => `<span class="ipa-chip ${s.ok ? "good" : s.ok === false ? "bad" : ""}" style="display:inline-flex;min-width:56px;margin:0 4px 4px 0">
      <span class="sp">${esc(s.expected.letters)}</span><span class="ipa">[${esc(s.ipa ?? "?")}]</span><span class="pc">target [${esc(VOWEL_IPA[s.expected.v] || s.expected.v)}]</span></span>`).join("");
  const wrong = res.syllables.filter((s) => s.ok === false);
  const notes = wrong.map((s) => `<li>“${esc(s.expected.letters)}” came out as [${esc(s.ipa)}]${s.polish ? "" : ` (${esc(s.note)})`}, Polish wants [${esc(VOWEL_IPA[s.expected.v] || s.expected.v)}].</li>`).join("");
  return `<div class="small"><b>${esc(word)}</b> · target /${target.join(" · ")}/</div>
    <div style="margin-top:6px">${cells}</div>
    ${wrong.length ? `<ul class="tips small">${notes}</ul>` : `<div class="result-banner ok">All vowels on target ✓</div>`}
    ${res.countMismatch ? `<p class="small muted">I found a different number of syllables than the word has — say it a little slower, with a short gap before and after.</p>` : ""}`;
}
