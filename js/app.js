import { GuidedSession, analyzeFree, recommend, diagnose, overallScore } from "./analyzer.js";
import { AudioAnalyzer } from "./audio.js";
import { ContinuousRecognizer, recognizeOnce, speechRecognitionSupported, speak, ttsSupported, hasPolishVoice } from "./recognizer.js";
import { PATTERN_BY_ID, NATIVE_LANGUAGES, TARGET_LANGUAGES, CATEGORY_LABELS, FLUENCY_TIPS, relevantPatterns, whyFor, severityFor } from "./profiles.js";
import { SAMPLE_TEXTS } from "./texts.js";
import { tokenize, normalizeWord, stressPattern, wordSimilarity } from "./polish.js";
import * as store from "./storage.js";
import { lineChart, ring } from "./charts.js";
import { mountVowelLab } from "./vowellab.js";

const REPO_URL = "https://github.com/ajaranbior/Akcentura";
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const settings = () => store.getState().settings;
const langs = () => (settings().nativeLangs.length ? settings().nativeLangs : ["be"]);
const speechLang = () => TARGET_LANGUAGES[settings().targetLang || "pl"].speechLang;

const ICON = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`,
};

// ---------------------------------------------------------------------------
// generic UI helpers
// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(msg, ms = 3500) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

let sheetCleanup = null;
function openSheet(title, html, { onClose, noClose = false } = {}) {
  closeSheet();
  const bd = document.createElement("div");
  bd.className = "sheet-backdrop";
  bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2>${noClose ? "" : `<button class="icon-btn" data-action="close-sheet" aria-label="Close">${ICON.close}</button>`}</div>
    <div class="sheet-body">${html}</div></div>`;
  if (!noClose) bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
  document.body.appendChild(bd);
  document.body.style.overflow = "hidden";
  sheetCleanup = onClose || null;
  return bd.querySelector(".sheet-body");
}
function closeSheet() {
  const bd = $(".sheet-backdrop");
  if (bd) bd.remove();
  document.body.style.overflow = "";
  if (sheetCleanup) { const f = sheetCleanup; sheetCleanup = null; f(); }
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
const speakBtn = (text, label = "Listen", cls = "icon-btn sm") =>
  ttsSupported ? `<button class="${cls}" type="button" data-action="speak" data-text="${esc(text)}" aria-label="${esc(label)}: ${esc(text)}" title="${esc(label)}">${ICON.play}</button>` : "";
const micBtn = (word, pattern = "") =>
  speechRecognitionSupported ? `<button class="icon-btn sm" type="button" data-action="practice-word" data-word="${esc(word)}" data-pattern="${esc(pattern)}" aria-label="Practise ${esc(word)}" title="Practise">${ICON.mic}</button>` : "";

function updateLangPill() {
  const l = langs().map((x) => x.toUpperCase()).join("+");
  $("#langPill").textContent = `${l} → ${(settings().targetLang || "pl").toUpperCase()}`;
}

function applyTheme() {
  const t = settings().theme || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

let currentView = "read";
let vowelLab = null;
function showView(name) {
  if (session && session.running && name !== "read") {
    toast("Stop the reading first.");
    return;
  }
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".bottomnav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (vowelLab && name !== "practice") { vowelLab.stop(); }
  if (name === "read") renderRead();
  if (name === "practice") renderPractice();
  if (name === "progress") renderProgress();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// READ view
// ---------------------------------------------------------------------------

let readMode = "text"; // text | book
let selectedText = null; // {id, title, text}
let session = null;
let lastReport = null;

function allTexts() {
  return [...store.getState().customTexts.map((t) => ({ ...t, custom: true })), ...SAMPLE_TEXTS];
}

function renderRead() {
  const root = $("#view-read");
  if (session && session.running) return; // live UI is managed by the session
  if (lastReport) return renderResults(root, lastReport);
  if (!selectedText) selectedText = allTexts()[0];

  const unsupported = !speechRecognitionSupported
    ? `<div class="notice">Speech recognition is not available in this browser, so words can’t be checked. Use <b>Chrome</b>, <b>Edge</b> or <b>Safari</b> (desktop, Android or iOS). You can still use book mode for pace, pauses and melody, and the Vowel lab.</div>`
    : "";
  const textList = allTexts()
    .map((t) => `<button type="button" class="chip ${selectedText && selectedText.id === t.id ? "on" : ""}" data-action="pick-text" data-id="${t.id}">${esc(t.title)} ${t.level ? `<span class="lvl">${t.level}</span>` : `<span class="lvl">mine</span>`}</button>`)
    .join("");
  const preview = selectedText ? esc(selectedText.text.slice(0, 220)) + (selectedText.text.length > 220 ? "…" : "") : "";
  const focus = selectedText && selectedText.focus ? selectedText.focus.filter((f) => severityFor(PATTERN_BY_ID[f], langs()) > 0).map((f) => `<span class="badge">${esc(PATTERN_BY_ID[f].title)}</span>`).join(" ") : "";

  root.innerHTML = `
    ${unsupported}
    <div class="segmented" role="tablist" style="margin-bottom:14px">
      <button type="button" role="tab" class="${readMode === "text" ? "active" : ""}" data-action="mode" data-mode="text">Read a text</button>
      <button type="button" role="tab" class="${readMode === "book" ? "active" : ""}" data-action="mode" data-mode="book">My book · just listen</button>
    </div>
    ${readMode === "text" ? `
      <div class="card">
        <h3>Choose a text</h3>
        <div class="chips" style="margin:10px 0 12px">${textList}</div>
        <div class="row">
          <button class="btn small" type="button" data-action="paste-text">Paste text</button>
          <label class="btn small" style="cursor:pointer">Upload .txt<input type="file" accept=".txt,.md,text/plain" id="fileInput" hidden></label>
          ${selectedText && selectedText.custom ? `<button class="btn small ghost" type="button" data-action="delete-text" data-id="${selectedText.id}">Remove “${esc(selectedText.title)}”</button>` : ""}
        </div>
      </div>
      ${selectedText ? `<div class="card">
        <div class="row between"><h3 style="margin:0">${esc(selectedText.title)}</h3>${speakBtn(selectedText.text, "Listen to the whole text", "btn small")}</div>
        <p class="muted small" style="margin-top:8px">${preview}</p>
        ${focus ? `<div class="row small" style="gap:6px">Good for: ${focus}</div>` : ""}
      </div>` : ""}
      <button class="btn primary" style="width:100%;min-height:54px" type="button" data-action="start" ${selectedText ? "" : "disabled"}>${ICON.mic} Start reading</button>
      <p class="small muted" style="margin-top:10px">Read at your own pace. Repeating a word or sentence is fine — Akcentura notices what you repeat and uses it to find the sounds you struggle with.</p>
    ` : `
      <div class="card">
        <h3>Reading from a physical book</h3>
        <p>Put the phone or laptop next to your book and read aloud. Akcentura listens to:</p>
        <ul class="tips">
          <li><b>words you repeat or correct</b> — and which sounds changed between attempts (e.g. <i>kat → kot</i> = akanie),</li>
          <li><b>pace, hesitation pauses, melody</b> and whether your voice fades at the end of sentences,</li>
          <li>how sure the recogniser was about what you said.</li>
        </ul>
        <p class="small muted">Afterwards you can paste or type the page text to get an exact word-by-word score.</p>
      </div>
      <button class="btn primary" style="width:100%;min-height:54px" type="button" data-action="start">${ICON.mic} Start listening</button>
    `}
  `;
  const fi = $("#fileInput", root);
  if (fi) fi.addEventListener("change", onUpload);
}

async function onUpload(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 500_000) { toast("That file is too large (max 500 KB)."); return; }
  const text = (await f.text()).trim();
  if (!tokenize(text).length) { toast("No readable text in that file."); return; }
  selectedText = store.addCustomText(f.name.replace(/\.[^.]+$/, ""), text);
  renderRead();
  toast("Text added.");
}

function openPasteSheet() {
  const body = openSheet("Paste a text", `
    <div class="stack">
      <input type="text" id="pTitle" placeholder="Title (optional)">
      <textarea id="pText" placeholder="Wklej tutaj tekst po polsku…" rows="8"></textarea>
      <button class="btn primary" type="button" id="pSave">Use this text</button>
    </div>`);
  $("#pSave", body).addEventListener("click", () => {
    const text = $("#pText", body).value.trim();
    if (!tokenize(text).length) { toast("Please paste some Polish text."); return; }
    const title = $("#pTitle", body).value.trim() || text.split(/\s+/).slice(0, 4).join(" ") + "…";
    selectedText = store.addCustomText(title, text);
    closeSheet();
    renderRead();
  });
}

// ---------- live session ----------

async function startSession(textItem = null) {
  closeSheet();
  if (currentView !== "read") showView("read");
  lastReport = null;
  const mode = textItem ? "text" : readMode;
  const text = mode === "text" ? (textItem || selectedText) : null;
  if (mode === "text" && !speechRecognitionSupported) {
    toast("Reading a text needs speech recognition (Chrome, Edge or Safari).");
    return;
  }
  session = {
    mode,
    text,
    guided: mode === "text" ? new GuidedSession(text.text, langs()) : null,
    phrases: [],
    start: Date.now(),
    running: true,
    analyzer: null,
    recognizer: null,
    pitch: [],
  };
  renderLive();

  if (settings().analyzeVoice || !speechRecognitionSupported) {
    session.analyzer = new AudioAnalyzer({ onFrame: onAudioFrame });
    try {
      await session.analyzer.start();
    } catch (e) {
      session.analyzer = null;
      if (!speechRecognitionSupported) { toast("Microphone not available: " + e.message); session = null; renderRead(); return; }
      toast("Voice analysis unavailable (" + e.message + "). Words are still checked.");
    }
  }
  if (speechRecognitionSupported) {
    session.recognizer = new ContinuousRecognizer({
      lang: speechLang(),
      onFinal: onFinal,
      onInterim: (t) => { const el = $("#interim"); if (el) el.textContent = t || (session && session.running ? "…" : ""); },
      onError: onRecError,
      onState: (s) => { const el = $("#recStatus"); if (el && session && session.running) el.textContent = s === "listening" ? "Listening…" : "Paused"; },
    });
    try { session.recognizer.start(); } catch (e) { toast(e.message); }
  }
  requestWakeLock();
  session.timer = setInterval(() => {
    const el = $("#recTime");
    if (el && session) el.textContent = fmtDur((Date.now() - session.start) / 1000);
  }, 500);
}

function onRecError(err) {
  if (!session) return;
  if (err === "audio-capture" && session.analyzer) {
    // some phones can't share the microphone between recognition and analysis
    session.analyzer.stop();
    session.analyzer = null;
    store.updateSettings({ analyzeVoice: false });
    toast("Your device can’t analyse voice and recognise speech at the same time — voice analysis turned off.");
    setTimeout(() => { if (session && session.running) { try { session.recognizer.start(); } catch { /* ignore */ } } }, 300);
    return;
  }
  const msgs = {
    "not-allowed": "Microphone access was blocked. Allow it in the browser’s site settings.",
    "service-not-allowed": "Speech recognition is blocked in this browser.",
    network: "Speech recognition needs an internet connection.",
    "language-not-supported": "Polish speech recognition isn’t available in this browser.",
    "restart-loop": "Speech recognition keeps stopping. Try reloading the page.",
  };
  toast(msgs[err] || `Speech recognition: ${err}`);
}

function renderLive() {
  const root = $("#view-read");
  const s = session;
  const body = s.mode === "text"
    ? `<div class="card" style="padding:0"><div class="row between" style="padding:12px 16px 0"><b>${esc(s.text.title)}</b><span class="small muted">tap a word to hear it</span></div>
        <div class="reading-text" id="readingText">${renderTextSpans(s.guided)}</div></div>
        <div class="legend" style="margin:-4px 2px 12px">
          <span style="--c:var(--good-soft)">clear</span><span style="--c:var(--fixed-soft)">fixed on repeat</span>
          <span style="--c:var(--warn-soft)">almost</span><span style="--c:var(--bad-soft)">unclear / missed</span></div>`
    : `<div class="card"><div class="row between"><b>What I heard</b><span class="small muted" id="wordCount">0 words</span></div>
        <div class="transcript" id="transcript"><p class="muted small">Start reading from your book…</p></div></div>`;
  root.innerHTML = `
    ${body}
    <div class="recorder">
      <button class="mic-btn live" type="button" data-action="stop" aria-label="Stop">${ICON.stop}</button>
      <div class="rec-info">
        <div class="row between"><span class="rec-status" id="recStatus">Starting…</span><span class="small muted" id="recTime">0:00</span></div>
        <div class="rec-interim" id="interim"></div>
        <div class="meter"><div id="meter"></div></div>
        <canvas class="pitch-canvas" id="pitchCanvas" aria-hidden="true"></canvas>
      </div>
    </div>`;
}

function renderTextSpans(guided) {
  const text = guided.text;
  let html = "", pos = 0;
  guided.tokens.forEach((t, i) => {
    html += esc(text.slice(pos, t.start));
    html += `<span class="w" data-i="${i}" data-action="speak-word">${esc(t.surface)}</span>`;
    pos = t.end;
  });
  html += esc(text.slice(pos));
  return html.replace(/\n/g, "<br>");
}

function onFinal(res) {
  const s = session;
  if (!s) return;
  s.phrases.push(res);
  if (s.mode === "text") {
    const touched = s.guided.addPhrase(res.text, res.confidence, res.time);
    const container = $("#readingText");
    if (!container) return;
    for (const i of touched) {
      const span = container.querySelector(`[data-i="${i}"]`);
      if (span) {
        span.className = "w " + s.guided.wordStatus(s.guided.words[i]);
      }
    }
    container.querySelectorAll(".w.cursor").forEach((x) => x.classList.remove("cursor"));
    const cur = container.querySelector(`[data-i="${s.guided.cursor}"]`);
    if (cur) {
      cur.classList.add("cursor");
      const r = cur.getBoundingClientRect(), cr = container.getBoundingClientRect();
      if (r.top > cr.bottom - 60 || r.top < cr.top) container.scrollTop += r.top - cr.top - 60;
    }
    if (s.guided.maxReached >= s.guided.words.length - 1) {
      const st = $("#recStatus");
      if (st) st.textContent = "Done? Tap stop ■";
    }
  } else {
    const tr = $("#transcript");
    if (!tr) return;
    if (s.phrases.length === 1) tr.innerHTML = "";
    const prevTokens = s.phrases.slice(-2, -1).flatMap((p) => tokenize(p.text));
    const words = tokenize(res.text);
    // highlight words repeated from the previous phrase or within this one
    const html = res.text.split(/(\s+)/).map((part) => {
      const w = normalizeWord(part);
      if (!w) return esc(part);
      const rep = prevTokens.includes(w) || words.filter((x) => x === w).length > 1;
      return rep && w.length > 2 ? `<span class="rep">${esc(part)}</span>` : esc(part);
    }).join("");
    const p = document.createElement("span");
    p.className = "ph" + (res.confidence > 0 && res.confidence < 0.55 ? " low" : "");
    p.innerHTML = html;
    tr.appendChild(p);
    tr.scrollTop = tr.scrollHeight;
    const wc = $("#wordCount");
    if (wc) wc.textContent = `${s.phrases.reduce((n, x) => n + tokenize(x.text).length, 0)} words`;
  }
}

function onAudioFrame(fr) {
  const m = $("#meter");
  if (m) {
    const pct = Math.max(0, Math.min(100, ((fr.db + 60) / 50) * 100));
    m.style.width = pct + "%";
    m.style.background = fr.speech ? "var(--good)" : "var(--muted)";
  }
  if (!session) return;
  session.pitch.push(fr.f0 ? 12 * Math.log2(fr.f0 / 100) : null);
  if (session.pitch.length > 200) session.pitch.shift();
  if ((session.pitchDraw = (session.pitchDraw || 0) + 1) % 3) return;
  const c = $("#pitchCanvas");
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const vals = session.pitch.filter((v) => v != null);
  if (vals.length < 3) return;
  const sorted = [...vals].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)] - 2, hi = sorted[Math.floor(sorted.length * 0.95)] + 2;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--chart");
  session.pitch.forEach((v, i) => {
    if (v == null) return;
    const x = (i / 200) * w;
    const y = h - ((v - lo) / Math.max(4, hi - lo)) * h;
    ctx.fillRect(x, Math.max(0, Math.min(h - 2, y)), 2, 2);
  });
}

let wakeLock = null;
async function requestWakeLock() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* ignore */ }
}
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }

async function stopSession() {
  const s = session;
  if (!s || !s.running) return;
  s.running = false;
  const st = $("#recStatus");
  if (st) st.textContent = "Analysing…";
  if (s.recognizer) {
    s.recognizer.stop();
    await new Promise((r) => setTimeout(r, 900)); // let the last result arrive
  }
  clearInterval(s.timer);
  releaseWakeLock();
  const durationSec = (Date.now() - s.start) / 1000;
  const base = { title: s.mode === "text" ? s.text.title : "Book reading", durationSec, date: new Date(s.start).toISOString() };
  let report = s.mode === "text" ? s.guided.report(base) : analyzeFree(s.phrases, langs(), base);
  if (s.analyzer) {
    report.fluency = s.analyzer.summary(speechRecognitionSupported ? report.syllables : 0);
    if (report.fluency && report.fluency.score == null) report.fluency = null;
    s.analyzer.stop();
  }
  report.overall = overallScore(report);
  report.phrases = s.phrases.map((p) => ({ text: p.text, confidence: p.confidence }));
  report.textId = s.text ? s.text.id : null;
  if (report.wordsRead >= 3 || report.fluency) store.addSession(report);
  else toast("Too little speech to score. Try reading a few sentences.");
  session = null;
  lastReport = report;
  renderRead();
}

// ---------- results ----------

function statBox(k, v, unit = "") {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v ?? "–"}${v != null && unit ? `<small>${unit}</small>` : ""}</div></div>`;
}

function fluencyCard(f) {
  if (!f) return "";
  const notes = [];
  if (f.rate < 3) notes.push(["rate", FLUENCY_TIPS.rate.low]);
  if (f.rate > 6.5) notes.push(["rate", FLUENCY_TIPS.rate.high]);
  if (f.hesitationRate > 14) notes.push(["pauses", FLUENCY_TIPS.pauses.high]);
  if (f.pitchStd != null && f.pitchStd < 1.6) notes.push(["pitch", FLUENCY_TIPS.pitch.low]);
  if (f.trailing != null && f.trailing > 0.35) notes.push(["trailing", FLUENCY_TIPS.trailing.high]);
  if (f.npvi != null && f.npvi > 62) notes.push(["rhythm", FLUENCY_TIPS.rhythm.low]);
  return `<div class="card">
    <div class="row between"><h3 style="margin:0">Fluency & confidence</h3><span class="badge ${f.score >= 75 ? "good" : f.score >= 55 ? "warn" : "bad"}">${f.score}/100</span></div>
    <div class="grid2" style="margin-top:12px">
      ${statBox("Pace", f.rate, " syll/s")}
      ${statBox("Hesitation pauses", f.hesitationRate, " /min")}
      ${statBox("Melody range", f.pitchStd, " semitones")}
      ${statBox("Fading endings", f.trailing != null ? Math.round(f.trailing * 100) : null, "%")}
    </div>
    <p class="small muted" style="margin-top:10px">Natural Polish reading: ~4.5–6 syllables/s, few pauses inside sentences, a lively melody (≥2 semitones) and full volume to the end of the sentence.${f.npvi != null ? ` Rhythm variability (nPVI): ${f.npvi}.` : ""}</p>
    ${notes.length ? `<ul class="tips">${notes.map(([k, t]) => `<li><b>${FLUENCY_TIPS[k].title}:</b> ${esc(t)}</li>`).join("")}</ul>` : `<p class="small"><b>Nice:</b> pace, pauses and melody sound confident.</p>`}
  </div>`;
}

function focusCards(recs) {
  return recs.slice(0, 3).map((r) => {
    const p = PATTERN_BY_ID[r.id];
    return `<div class="card focus-card tight">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
        <span class="symbol">${esc(p.symbol)}</span>
        <div style="flex:1;min-width:0"><b>${esc(p.title)}</b> ${r.err > 0 ? `<span class="badge bad">detected</span>` : r.sus >= 0.5 ? `<span class="badge warn">suspected</span>` : `<span class="badge">typical</span>`}
          <div class="small">${esc(r.reason)}</div>
          <div class="small muted">${esc(p.summary)}</div></div>
      </div>
      <div class="row" style="margin-top:8px"><button class="btn small" type="button" data-action="pattern" data-id="${p.id}">How to fix</button>
      ${p.minimalPairs.length && speechRecognitionSupported ? `<button class="btn small" type="button" data-action="pair-drill" data-id="${p.id}">Minimal-pair drill</button>` : ""}</div>
    </div>`;
  }).join("");
}

function struggleList(words, limit = 12) {
  if (!words.length) return `<p class="muted small">No problem words — everything was clear on the first try.</p>`;
  return `<ul class="word-list">${words.slice(0, limit).map((w) => {
    const pats = (w.diagnosed || []).filter((d) => d !== "clarity").map((d) => PATTERN_BY_ID[d]?.title).filter(Boolean);
    const sub = [
      w.heard && w.heard.length ? `heard as “${w.heard.slice(0, 3).map(esc).join("”, “")}”` : "",
      w.attempts > 1 ? `${w.attempts} attempts${w.fixed ? " → clear" : ""}` : "",
      w.lowConfidence ? "recogniser unsure" : "",
      pats.length ? pats.join(", ") : "",
    ].filter(Boolean).join(" · ");
    return `<li><div class="wl-main"><div class="wl-word">${esc(w.surface || w.word)} <span class="small muted">${esc(stressPattern(w.word))}</span></div><div class="wl-sub">${sub}</div></div>
      ${speakBtn(w.word)} ${micBtn(w.word, (w.diagnosed || [])[0] || "")}</li>`;
  }).join("")}</ul>`;
}

function renderResults(root, r) {
  const sub = r.mode === "guided"
    ? `${statBox("Accuracy", r.accuracy, "%")}${statBox("First try", r.firstTry, "%")}${statBox("Fluency", r.fluency ? r.fluency.score : null)}`
    : `${statBox("Recogniser clarity", r.clarity, "%")}${statBox("Clean first reads", r.firstTry, "%")}${statBox("Fluency", r.fluency ? r.fluency.score : null)}`;
  const coloured = r.words
    ? `<div class="card"><h3>Your reading</h3><div class="reading-text" style="padding:0;max-height:none">${r.words.map((w) => `<span class="w ${w.s}" data-action="speak" data-text="${esc(w.w)}">${esc(w.w)}</span>`).join(" ")}</div>
       <div class="legend" style="margin-top:10px"><span style="--c:var(--good-soft)">clear</span><span style="--c:var(--fixed-soft)">repeated / fixed</span><span style="--c:var(--warn-soft)">almost</span><span style="--c:var(--bad-soft)">unclear / missed</span></div></div>`
    : "";
  const rescore = r.mode === "free" && r.phrases && r.phrases.length
    ? `<div class="card"><h3>Score it exactly</h3><p class="small muted">Type or paste the page you just read; the same recording is re-scored word by word.</p>
       <textarea id="rescoreText" rows="5" placeholder="Wklej tekst strony…"></textarea>
       <button class="btn" type="button" data-action="rescore" style="margin-top:8px">Re-score with this text</button></div>`
    : "";
  const transcript = r.mode === "free" && r.phrases && r.phrases.length
    ? `<details class="card"><summary>What I heard</summary><div class="transcript" style="margin-top:10px">${r.phrases.map((p) => `<span class="ph ${p.confidence > 0 && p.confidence < 0.55 ? "low" : ""}">${esc(p.text)}</span>`).join("")}</div></details>`
    : "";
  root.innerHTML = `
    <div class="card">
      <div class="score-hero">
        ${ring(r.overall, "score")}
        <div style="min-width:0">
          <h2 style="margin:0">${esc(r.title)}</h2>
          <div class="small muted">${fmtDate(r.date)} · ${fmtDur(r.durationSec)} · ${r.wordsRead} words · ${r.repeats} repeats</div>
        </div>
      </div>
      <div class="grid3" style="margin-top:14px">${sub}</div>
      ${r.overall == null ? `<p class="small muted" style="margin-top:10px">Not enough data for a score — read a little longer next time.</p>` : ""}
    </div>
    <h3 style="margin:18px 2px 10px">Focus on</h3>
    ${focusCards(r.recommendations || [])}
    <div class="card"><h3>Words to say clearer</h3>${struggleList(r.struggleWords || [])}</div>
    ${fluencyCard(r.fluency)}
    ${coloured}
    ${rescore}
    ${transcript}
    <div class="row" style="margin:8px 0 24px">
      ${r.textId ? `<button class="btn primary" type="button" data-action="read-again">Read again</button>` : ""}
      <button class="btn" type="button" data-action="new-reading">New reading</button>
    </div>`;
}

function rescore() {
  const text = ($("#rescoreText") || {}).value || "";
  if (!tokenize(text).length) { toast("Paste the text first."); return; }
  const r = lastReport;
  const g = new GuidedSession(text, langs());
  for (const p of r.phrases) g.addPhrase(p.text, p.confidence);
  const nr = g.report({ title: r.title + " (with text)", durationSec: r.durationSec, date: r.date, fluency: r.fluency });
  nr.overall = overallScore(nr);
  nr.phrases = r.phrases;
  store.deleteSession(r.id);
  store.addSession(nr);
  const custom = store.addCustomText(r.title + " " + new Date(r.date).toLocaleDateString(), text);
  nr.textId = custom.id;
  lastReport = nr;
  renderRead();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// pattern sheet + drills
// ---------------------------------------------------------------------------

function openPattern(id) {
  const p = PATTERN_BY_ID[id];
  if (!p) return;
  const agg = store.aggregatePatterns(store.getState().sessions)[id];
  const drill = store.getState().drills[id];
  const why = whyFor(p, langs()).map((w) => `<p><span class="badge">${NATIVE_LANGUAGES[w.lang].name}</span> ${esc(w.text)}</p>`).join("");
  const isVowel = ["akanie", "open_o", "y_i", "yakanie"].includes(id);
  const body = openSheet(p.title, `
    <p><b>${esc(p.summary)}</b></p>
    ${why}
    ${agg && agg.opp ? `<p class="small muted">Your data: ${agg.err} misheard + ${Math.round(agg.sus * 10) / 10} repeated in ${agg.opp} words with this sound${drill ? ` · drills ${drill.ok}/${drill.tries} correct` : ""}.</p>` : ""}
    <div class="card"><h3>How to say it</h3><ul class="tips">${p.howTo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Exercises</h3><ol class="tips">${p.exercises.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
      <div class="row">
        ${p.minimalPairs.length && speechRecognitionSupported ? `<button class="btn small primary" type="button" data-action="pair-drill" data-id="${p.id}">Minimal-pair drill</button>` : ""}
        ${isVowel ? `<button class="btn small" type="button" data-action="goto-vowel-lab" data-v="${id === "y_i" ? "y" : id === "yakanie" ? "e" : "o"}">Open Vowel lab</button>` : ""}
      </div></div>
    <div class="card"><h3>Practice words</h3><ul class="word-list">${p.practiceWords.map((w) => `<li><div class="wl-main"><div class="wl-word">${esc(w)}</div><div class="wl-sub">${esc(stressPattern(w))}</div></div>${speakBtn(w)} ${micBtn(w, p.id)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Say it fast</h3><p style="font-family:Georgia,serif;font-size:1.1rem">${esc(p.twister)}</p>
      <div class="row">${speakBtn(p.twister, "Listen", "btn small")}${speechRecognitionSupported ? `<button class="btn small" type="button" data-action="read-twister" data-id="${p.id}">${ICON.mic} Read it</button>` : ""}</div></div>
  `);
  body.scrollTop = 0;
}

async function listenFor(target) {
  const alts = await recognizeOnce(speechLang());
  const words = alts.flatMap((a, rank) => tokenize(a.text).map((w) => ({ w, rank })));
  const top = alts[0] ? tokenize(alts[0].text) : [];
  return { alts, words, top };
}

function evaluateWord(target, res, contrast = null) {
  const t = normalizeWord(target);
  if (!res.alts.length) return { kind: "none", text: "I didn’t hear anything — tap the mic and try again." };
  const topHit = res.top.some((w) => wordSimilarity(w, t) >= 0.97);
  const contrastHit = contrast && res.top.some((w) => wordSimilarity(w, contrast) >= 0.97);
  if (topHit && !contrastHit) return { kind: "ok", text: `✓ Clear: “${target}”` };
  if (contrastHit) {
    const d = diagnose(t, normalizeWord(contrast)).filter((x) => x.id !== "clarity");
    return { kind: "no", text: `Heard “${contrast}” instead of “${target}”.`, heard: contrast, d };
  }
  const anyHit = res.words.some((x) => wordSimilarity(x.w, t) >= 0.97);
  // closest word in the top result
  let best = null, bs = 0;
  for (const w of res.top) { const s = wordSimilarity(w, t); if (s > bs) { bs = s; best = w; } }
  const d = best ? diagnose(t, best).filter((x) => x.id !== "clarity") : [];
  if (anyHit) return { kind: "meh", text: `Almost — the recogniser hesitated (top guess “${alts0(res)}”).`, heard: best, d };
  return { kind: "no", text: `Heard “${alts0(res)}”.`, heard: best, d };
}
const alts0 = (res) => (res.alts[0] ? res.alts[0].text : "");

function hintFor(d) {
  if (!d || !d.length) return "";
  return `<ul class="tips small" style="margin-top:8px">${d.map((x) => {
    const p = PATTERN_BY_ID[x.id];
    return p ? `<li><b>${esc(p.title)}</b> (${esc(x.from)} → ${esc(x.to || "∅")}): ${esc(p.howTo[0])}</li>` : "";
  }).join("")}</ul>`;
}

function openWordPractice(word, patternId = "") {
  const body = openSheet("Practise a word", `
    <div class="big-word">${esc(word)}</div>
    <div class="stress-hint">${esc(stressPattern(word))}</div>
    <div class="row" style="justify-content:center;margin:16px 0">
      ${speakBtn(word, "Listen", "btn")}
      <button class="btn primary" type="button" id="wpMic">${ICON.mic} Say it</button>
    </div>
    <div id="wpResult"></div>
    <p class="small muted" style="margin-top:12px">Tip: if single words aren’t recognised, say it in a short phrase: “Mówię: ${esc(word)}”.</p>`);
  const btn = $("#wpMic", body);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = `${ICON.mic} Listening…`;
    try {
      const res = await listenFor(word);
      const ev = evaluateWord(word, res);
      $("#wpResult", body).innerHTML = `<div class="result-banner ${ev.kind === "ok" ? "ok" : ev.kind === "meh" || ev.kind === "none" ? "meh" : "no"}">${esc(ev.text)}</div>${hintFor(ev.d)}`;
      if (ev.kind !== "none") {
        store.recordWordPractice(normalizeWord(word), ev.kind === "ok", ev.heard, patternId ? [patternId] : []);
        if (patternId && PATTERN_BY_ID[patternId]) store.recordDrill(patternId, ev.kind === "ok");
      }
    } catch (e) {
      $("#wpResult", body).innerHTML = `<div class="result-banner meh">${esc(e.message)}</div>`;
    }
    btn.disabled = false;
    btn.innerHTML = `${ICON.mic} Say it again`;
  });
}

function openPairDrill(id) {
  const p = PATTERN_BY_ID[id];
  if (!p || !p.minimalPairs.length) return;
  let round = 0, ok = 0;
  const N = Math.min(8, p.minimalPairs.length * 2);
  const queue = [];
  for (let i = 0; i < N; i++) {
    const pair = p.minimalPairs[i % p.minimalPairs.length];
    // mostly practise the Polish target sound, sometimes the contrast word
    queue.push(i % 3 === 2 ? [pair[1], pair[0]] : [pair[0], pair[1]]);
  }
  const body = openSheet(`${p.title}: minimal pairs`, `<div id="pdBody"></div>`);
  const host = $("#pdBody", body);
  const next = () => {
    if (round >= queue.length) {
      host.innerHTML = `<div class="result-banner ${ok / queue.length >= 0.75 ? "ok" : "meh"}">${ok} / ${queue.length} recognised as intended</div>
        <p class="small muted" style="margin-top:10px">${ok / queue.length >= 0.75 ? "Great contrast! Use it in real reading now." : "Keep going — exaggerate the difference, then relax back to normal."}</p>
        <div class="row"><button class="btn primary" type="button" id="pdAgain">Again</button><button class="btn" type="button" data-action="pattern" data-id="${p.id}">Tips</button></div>`;
      $("#pdAgain", host).addEventListener("click", () => { round = 0; ok = 0; next(); });
      return;
    }
    const [target, contrast] = queue[round];
    host.innerHTML = `
      <p class="small muted">Round ${round + 1} of ${queue.length}. Say the <b>big</b> word so that it can’t be mistaken for the small one.</p>
      <div class="pair card"><div><div class="target">${esc(target)}</div>${speakBtn(target)}</div><div class="muted">not</div><div><div class="contrast">${esc(contrast)}</div>${speakBtn(contrast)}</div></div>
      <div class="row" style="justify-content:center"><button class="btn primary" type="button" id="pdMic">${ICON.mic} Say “${esc(target)}”</button></div>
      <div id="pdRes" style="margin-top:12px"></div>`;
    const mic = $("#pdMic", host);
    mic.addEventListener("click", async () => {
      mic.disabled = true;
      mic.innerHTML = `${ICON.mic} Listening…`;
      try {
        const res = await listenFor(target);
        const ev = evaluateWord(target, res, contrast);
        if (ev.kind === "none") {
          $("#pdRes", host).innerHTML = `<div class="result-banner meh">${esc(ev.text)}</div>`;
          mic.disabled = false;
          mic.innerHTML = `${ICON.mic} Say “${esc(target)}”`;
          return;
        }
        const good = ev.kind === "ok";
        if (good) ok++;
        store.recordDrill(p.id, good);
        $("#pdRes", host).innerHTML = `<div class="result-banner ${good ? "ok" : "no"}">${esc(ev.text)}</div>${good ? "" : hintFor(ev.d)}
          <div class="row" style="justify-content:center;margin-top:10px"><button class="btn" type="button" id="pdNext">Next →</button></div>`;
        $("#pdNext", host).addEventListener("click", () => { round++; next(); });
        if (good) setTimeout(() => { if ($("#pdNext", host)) { round++; next(); } }, 1100);
      } catch (e) {
        $("#pdRes", host).innerHTML = `<div class="result-banner meh">${esc(e.message)}</div>`;
        mic.disabled = false;
      }
    });
  };
  next();
}

// ---------------------------------------------------------------------------
// PRACTICE view
// ---------------------------------------------------------------------------

function overallRecommendations() {
  const sessions = store.getState().sessions;
  const agg = store.aggregatePatterns(sessions.slice(-15));
  const stats = {};
  for (const [id, a] of Object.entries(agg)) stats[id] = { opp: a.opp, err: a.err, sus: a.sus, examples: [] };
  // include examples from the latest sessions
  for (const s of sessions.slice(-15)) for (const [id, st] of Object.entries(s.patternStats || {})) if (stats[id] && st.examples) stats[id].examples.push(...st.examples);
  return recommend(stats, langs(), 5);
}

function renderPractice() {
  const root = $("#view-practice");
  const recs = overallRecommendations();
  const words = Object.entries(store.getState().words)
    .filter(([, w]) => w.fails + (w.repeats || 0) > 0 && w.okStreak < 3)
    .sort((a, b) => (b[1].fails * 2 + (b[1].repeats || 0)) - (a[1].fails * 2 + (a[1].repeats || 0)))
    .slice(0, 15);
  const groups = {};
  for (const p of relevantPatterns(langs())) (groups[p.category] ||= []).push(p);
  root.innerHTML = `
    <h2>Your focus</h2>
    <p class="small muted">Ranked from your readings${store.getState().sessions.length ? "" : " (no readings yet — based on what is typical for " + langs().map((l) => NATIVE_LANGUAGES[l].name).join(" + ") + " speakers)"}.</p>
    ${focusCards(recs)}
    <div class="card"><h3>Words to practise</h3>
      ${words.length ? `<ul class="word-list">${words.map(([w, d]) => `<li><div class="wl-main"><div class="wl-word">${esc(d.surface || w)} <span class="small muted">${esc(stressPattern(w))}</span></div>
        <div class="wl-sub">${d.fails} unclear · ${d.repeats || 0} repeats${d.heard && d.heard.length ? ` · heard “${d.heard.slice(0, 2).map(esc).join("”, “")}”` : ""}${d.okStreak ? ` · ${d.okStreak}/3 clear in a row` : ""}</div></div>
        ${speakBtn(w)} ${micBtn(w, (d.patterns || [])[0] || "")}</li>`).join("")}</ul>` : `<p class="muted small">Words you repeat or that aren’t recognised will appear here. Say one clearly 3 times in a row to master it.</p>`}
    </div>
    <div class="card" id="vowelLabCard"></div>
    <h3 style="margin:18px 2px 10px">All sounds</h3>
    ${Object.entries(groups).map(([cat, ps]) => `<div class="card tight"><div class="small muted" style="font-weight:700;margin-bottom:4px">${CATEGORY_LABELS[cat]}</div>
      <ul class="word-list">${ps.map((p) => `<li data-action="pattern" data-id="${p.id}" style="cursor:pointer"><span class="symbol">${esc(p.symbol)}</span><div class="wl-main"><div class="wl-word" style="font-size:1rem">${esc(p.title)}</div><div class="wl-sub">${esc(p.summary)}</div></div><span class="muted">›</span></li>`).join("")}</ul></div>`).join("")}
  `;
  if (vowelLab) vowelLab.stop();
  vowelLab = mountVowelLab($("#vowelLabCard"), { toast });
}

// ---------------------------------------------------------------------------
// PROGRESS view
// ---------------------------------------------------------------------------

function renderProgress() {
  const root = $("#view-progress");
  const sessions = store.getState().sessions;
  if (!sessions.length) {
    root.innerHTML = `<h2>Progress</h2><div class="card empty">Your scores and struggle areas will appear here after your first reading.<br><br><button class="btn primary" type="button" data-action="goto" data-view="read">Start reading</button></div>`;
    return;
  }
  const scored = sessions.filter((s) => s.overall != null).slice(-30);
  const totalMin = Math.round(sessions.reduce((s, x) => s + (x.durationSec || 0), 0) / 60);
  const totalWords = sessions.reduce((s, x) => s + (x.wordsRead || 0), 0);
  const agg = store.aggregatePatterns(sessions);
  const rows = relevantPatterns(langs())
    .map((p) => ({ p, a: agg[p.id] }))
    .filter((x) => x.a && x.a.opp >= 3)
    .sort((x, y) => y.a.rate - x.a.rate);
  const words = Object.entries(store.getState().words).sort((a, b) => b[1].fails - a[1].fails || (b[1].repeats || 0) - (a[1].repeats || 0)).slice(0, 12);
  const maxRate = Math.max(0.1, ...rows.map((r) => r.a.rate));

  root.innerHTML = `
    <h2>Progress</h2>
    <div class="grid3" style="margin-bottom:14px">${statBox("Readings", sessions.length)}${statBox("Minutes", totalMin)}${statBox("Words", totalWords)}</div>
    <div class="card"><h3>Overall score</h3><div id="scoreChart"></div></div>
    <div class="card"><h3>Struggle areas</h3>
      <p class="small muted">Share of words with this sound that were misheard or repeated (lower is better). Arrow: your last 5 readings vs. earlier.</p>
      ${rows.length ? rows.map(({ p, a }) => {
        const pct = Math.round(a.rate * 100);
        let trend = "";
        if (a.recentRate != null && a.earlierRate != null) {
          const diff = Math.round((a.earlierRate - a.recentRate) * 100);
          trend = diff >= 2 ? `<span class="trend up" title="improving">▼ ${diff}</span>` : diff <= -2 ? `<span class="trend down" title="getting worse">▲ ${-diff}</span>` : `<span class="trend muted">=</span>`;
        }
        return `<div class="bar-row" data-action="pattern" data-id="${p.id}" title="${esc(p.title)}: ${pct}% (${a.err} misheard, ${Math.round(a.sus * 10) / 10} repeated, ${a.opp} words)">
          <div><div style="font-weight:600">${esc(p.title)}</div><div class="small muted">${a.opp} words</div></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (a.rate / maxRate) * 100)}%"></div></div>
          <div class="trend">${pct}% ${trend}</div></div>`;
      }).join("") : `<p class="muted small">Read a bit more to measure your sounds.</p>`}
    </div>
    <div class="card"><h3>Pace (syllables per second)</h3><div id="paceChart"></div></div>
    <div class="card"><h3>Hardest words</h3>
      ${words.length ? `<ul class="word-list">${words.map(([w, d]) => `<li><div class="wl-main"><div class="wl-word">${esc(d.surface || w)}</div><div class="wl-sub">${d.fails} unclear · ${d.repeats || 0} repeats · ${d.okStreak >= 3 ? "mastered ✓" : `${d.okStreak || 0}/3 clear in a row`}</div></div>${speakBtn(w)} ${micBtn(w, (d.patterns || [])[0] || "")}</li>`).join("")}</ul>` : `<p class="small muted">None yet.</p>`}
    </div>
    <div class="card"><h3>History</h3><ul class="word-list">
      ${[...sessions].reverse().slice(0, 50).map((s) => `<li><div class="wl-main"><div class="wl-word" style="font-size:1rem">${esc(s.title)}</div>
        <div class="wl-sub">${fmtDate(s.date)} · ${s.mode === "guided" ? "text" : "book"} · ${s.wordsRead} words${s.fluency ? ` · ${s.fluency.rate} syll/s` : ""}</div></div>
        <b>${s.overall ?? "–"}</b><button class="icon-btn sm" type="button" data-action="delete-session" data-id="${s.id}" aria-label="Delete">${ICON.trash}</button></li>`).join("")}
    </ul></div>`;
  lineChart($("#scoreChart"), scored.map((s) => ({ label: new Date(s.date).toLocaleDateString(undefined, { day: "numeric", month: "short" }), value: s.overall, tip: `${fmtDate(s.date)} · ${s.title}: ${s.overall}` })));
  const paced = sessions.filter((s) => s.fluency && s.fluency.rate).slice(-30);
  const maxPace = Math.max(7, ...paced.map((s) => s.fluency.rate));
  lineChart($("#paceChart"), paced.map((s) => ({ label: new Date(s.date).toLocaleDateString(undefined, { day: "numeric", month: "short" }), value: s.fluency.rate, tip: `${fmtDate(s.date)}: ${s.fluency.rate} syll/s` })), { min: 0, max: Math.ceil(maxPace), ticks: [0, 3, 6], height: 140 });
}

// ---------------------------------------------------------------------------
// SETTINGS view + onboarding
// ---------------------------------------------------------------------------

function langCheckboxes(prefix) {
  return Object.entries(NATIVE_LANGUAGES).map(([code, l]) => `<label class="check"><input type="checkbox" name="${prefix}native" value="${code}" ${settings().nativeLangs.includes(code) ? "checked" : ""}> ${l.name} <span class="muted">${l.native}</span></label>`).join("");
}

function renderSettings() {
  const s = settings();
  const root = $("#view-settings");
  root.innerHTML = `
    <h2>Settings</h2>
    <div class="card"><h3>My native language(s)</h3><p class="small muted">Feedback and exercises are tailored to how these languages shape your Polish. Pick all that apply.</p>
      <div id="nativeBox">${langCheckboxes("s")}</div></div>
    <div class="card"><h3>Target language</h3>
      <select id="targetLang">${Object.entries(TARGET_LANGUAGES).map(([c, l]) => `<option value="${c}" ${s.targetLang === c ? "selected" : ""}>${l.name} (${l.native})</option>`).join("")}</select>
      <p class="small muted" style="margin-top:6px">More languages may come later.</p></div>
    <div class="card"><h3>Listening</h3>
      <label class="check"><input type="checkbox" id="analyzeVoice" ${s.analyzeVoice ? "checked" : ""}> Analyse my voice (pace, pauses, melody)</label>
      <p class="small muted">Turn off if recognition stops working on your phone — some Android devices can’t share the microphone.</p>
      <label style="display:block;margin-top:8px">My voice is <select id="voiceType" style="width:auto;margin-left:6px"><option value="male" ${s.voiceType === "male" ? "selected" : ""}>lower (typically male)</option><option value="female" ${s.voiceType === "female" ? "selected" : ""}>higher (typically female)</option></select></label>
      <p class="small muted">Used for the vowel targets in the Vowel lab until you calibrate.</p>
      <label style="display:block;margin-top:8px">Model voice speed: <b id="rateVal">${s.ttsRate}</b><input type="range" id="ttsRate" min="0.5" max="1.2" step="0.05" value="${s.ttsRate}" style="width:100%"></label>
      ${ttsSupported && !hasPolishVoice() ? `<p class="small" style="color:var(--warn)">No Polish voice found on this device — install one in your system’s text-to-speech settings to hear model pronunciation.</p>` : ""}
    </div>
    <div class="card"><h3>Appearance</h3>
      <div class="segmented">${["auto", "light", "dark"].map((t) => `<button type="button" data-action="theme" data-theme="${t}" class="${(s.theme || "auto") === t ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></div>
    <div class="card"><h3>My data</h3><p class="small muted">Everything is stored only in this browser. Back it up to move it to another device.</p>
      <div class="row"><button class="btn small" type="button" data-action="export">Export backup</button>
      <label class="btn small" style="cursor:pointer">Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
      <button class="btn small ghost" type="button" data-action="reset" style="color:var(--bad)">Delete all data</button></div></div>
    <div class="card"><h3>About</h3>
      <p class="small">Akcentura checks your Polish with the browser’s speech recogniser and analyses your voice on the device. Speech recognition in Chrome/Edge sends audio to the browser vendor’s servers; Akcentura itself has no server and stores nothing outside your browser.</p>
      <p class="small"><a href="${REPO_URL}#readme" target="_blank" rel="noopener">How it works, limitations & source code →</a></p></div>`;
  root.querySelectorAll('input[name="snative"]').forEach((cb) => cb.addEventListener("change", () => {
    const sel = [...root.querySelectorAll('input[name="snative"]:checked')].map((x) => x.value);
    if (!sel.length) { cb.checked = true; toast("Pick at least one language."); return; }
    store.updateSettings({ nativeLangs: sel });
    updateLangPill();
  }));
  $("#targetLang", root).addEventListener("change", (e) => store.updateSettings({ targetLang: e.target.value }));
  $("#analyzeVoice", root).addEventListener("change", (e) => store.updateSettings({ analyzeVoice: e.target.checked }));
  $("#voiceType", root).addEventListener("change", (e) => store.updateSettings({ voiceType: e.target.value }));
  $("#ttsRate", root).addEventListener("input", (e) => { store.updateSettings({ ttsRate: parseFloat(e.target.value) }); $("#rateVal").textContent = e.target.value; });
  $("#importFile", root).addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { store.importData(await f.text()); toast("Backup imported."); applyTheme(); updateLangPill(); renderSettings(); } catch (err) { toast(err.message); }
  });
}

function onboarding() {
  const body = openSheet("Witaj! Welcome to Akcentura", `
    <p>Read Polish out loud — from the screen or from your own book — and get feedback on the sounds, stress and rhythm that make you sound less native, with exercises tailored to your first language.</p>
    <div class="card"><h3>My native language(s)</h3>${langCheckboxes("o")}</div>
    <div class="card"><h3>I’m learning</h3><select disabled><option>Polish (polski)</option></select></div>
    ${speechRecognitionSupported ? "" : `<div class="notice">This browser can’t recognise speech. For word-level feedback open Akcentura in Chrome, Edge or Safari.</div>`}
    <p class="small muted">You’ll be asked for microphone access when you start reading. Your progress is saved only on this device.</p>
    <button class="btn primary" type="button" id="obGo" style="width:100%">Let’s start</button>`, { noClose: true });
  $("#obGo", body).addEventListener("click", () => {
    const sel = [...body.querySelectorAll('input[name="onative"]:checked')].map((x) => x.value);
    if (!sel.length) { toast("Pick at least one native language."); return; }
    store.updateSettings({ nativeLangs: sel, onboarded: true });
    updateLangPill();
    closeSheet();
    renderRead();
  });
}

// ---------------------------------------------------------------------------
// global actions
// ---------------------------------------------------------------------------

document.addEventListener("click", (e) => {
  const nav = e.target.closest(".bottomnav button[data-view]");
  if (nav) { showView(nav.dataset.view); return; }
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const act = a.dataset.action;
  switch (act) {
    case "close-sheet": closeSheet(); break;
    case "mode": readMode = a.dataset.mode; renderRead(); break;
    case "pick-text": selectedText = allTexts().find((t) => t.id === a.dataset.id) || null; renderRead(); break;
    case "paste-text": openPasteSheet(); break;
    case "delete-text": store.removeCustomText(a.dataset.id); selectedText = null; renderRead(); break;
    case "start": startSession(); break;
    case "stop": stopSession(); break;
    case "speak": speak(a.dataset.text, settings().ttsRate); break;
    case "speak-word": {
      if (session && session.guided) speak(session.guided.words[+a.dataset.i].surface, settings().ttsRate);
      break;
    }
    case "pattern": openPattern(a.dataset.id); break;
    case "pair-drill": openPairDrill(a.dataset.id); break;
    case "practice-word": openWordPractice(a.dataset.word, a.dataset.pattern); break;
    case "read-twister": {
      const p = PATTERN_BY_ID[a.dataset.id];
      startSession({ id: null, title: `Twister: ${p.title}`, text: p.twister });
      break;
    }
    case "goto-vowel-lab": {
      closeSheet();
      showView("practice");
      const card = $("#vowelLabCard");
      if (card) card.scrollIntoView({ behavior: "smooth" });
      if (vowelLab) vowelLab.setTarget(a.dataset.v);
      break;
    }
    case "read-again": {
      const t = allTexts().find((x) => x.id === lastReport.textId);
      lastReport = null;
      if (t) { selectedText = t; readMode = "text"; startSession(t); } else renderRead();
      break;
    }
    case "new-reading": lastReport = null; renderRead(); window.scrollTo({ top: 0 }); break;
    case "rescore": rescore(); break;
    case "goto": showView(a.dataset.view); break;
    case "delete-session":
      if (confirm("Delete this reading from your history?")) { store.deleteSession(a.dataset.id); renderProgress(); }
      break;
    case "theme": store.updateSettings({ theme: a.dataset.theme }); applyTheme(); renderSettings(); break;
    case "export": {
      const blob = new Blob([store.exportData()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `akcentura-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      break;
    }
    case "reset":
      if (confirm("Delete all readings, progress and settings on this device?")) { store.resetAll(); location.reload(); }
      break;
    default: break;
  }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
$("#langPill").addEventListener("click", () => showView("settings"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && session && session.running) requestWakeLock();
});

// ---------------------------------------------------------------------------
applyTheme();
updateLangPill();
renderRead();
if (!settings().onboarded || !settings().nativeLangs.length) onboarding();

// exposed for debugging / automated checks
window.akcentura = { store, startSession, stopSession, get session() { return session; }, onFinal: (t, c = 0.9) => onFinal({ text: t, confidence: c, time: Date.now() }) };
