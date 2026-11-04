// Local persistence (localStorage). Everything stays on the device.

const KEY = "akcentura:v1";

const DEFAULT = {
  settings: {
    nativeLangs: [],
    targetLang: "pl",
    analyzeVoice: true,
    voiceType: "male",
    ttsRate: 0.9,
    onboarded: false,
  },
  sessions: [], // reports (without the per-word list, to stay small)
  words: {}, // word -> {tries, fails, okStreak, last, heard:[], patterns:[]}
  drills: {}, // patternId -> {tries, ok}
  vowelCalibration: null, // {i:[f1,f2], a:[..], u:[..]}
  customTexts: [], // {id, title, text}
};

let state = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...structuredClone(DEFAULT), ...parsed, settings: { ...DEFAULT.settings, ...(parsed.settings || {}) } };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function getState() {
  if (!state) state = load();
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Could not save", e);
  }
}

export function updateSettings(patch) {
  Object.assign(getState().settings, patch);
  save();
}

/** Stores a finished report and updates the per-word history. */
export function addSession(report) {
  const s = getState();
  const { words, ...compact } = report;
  s.sessions.push(compact);
  if (s.sessions.length > 500) s.sessions.splice(0, s.sessions.length - 500);
  for (const sw of report.struggleWords || []) {
    if (sw.word.length < 2) continue;
    const w = (s.words[sw.word] ||= { tries: 0, fails: 0, okStreak: 0, heard: [], patterns: [] });
    w.tries += 1;
    const failed = sw.diagnosed.length > 0 || sw.lowConfidence || !sw.fixed;
    // a word that needed repeats but ended clear counts as a try, not a failure
    if (failed) { w.fails += 1; w.okStreak = 0; }
    w.last = report.date;
    w.surface = sw.surface;
    w.heard = [...new Set([...(sw.heard || []), ...w.heard])].slice(0, 6);
    w.patterns = sw.patterns;
    w.repeats = (w.repeats || 0) + Math.max(0, sw.attempts - 1);
  }
  save();
}

export function deleteSession(id) {
  const s = getState();
  s.sessions = s.sessions.filter((x) => x.id !== id);
  save();
}

/** Result of practising a single word (drill). */
export function recordWordPractice(word, ok, heard, patterns = []) {
  const s = getState();
  const w = (s.words[word] ||= { tries: 0, fails: 0, okStreak: 0, heard: [], patterns });
  w.tries += 1;
  if (ok) w.okStreak += 1;
  else { w.fails += 1; w.okStreak = 0; if (heard) w.heard = [...new Set([heard, ...w.heard])].slice(0, 6); }
  w.last = new Date().toISOString();
  save();
}

export function recordDrill(patternId, ok) {
  const s = getState();
  const d = (s.drills[patternId] ||= { tries: 0, ok: 0, history: [] });
  d.tries += 1;
  if (ok) d.ok += 1;
  d.history.push(ok ? 1 : 0);
  if (d.history.length > 200) d.history.shift();
  save();
}

export function setVowelCalibration(cal) {
  getState().vowelCalibration = cal;
  save();
}

export function addCustomText(title, text) {
  const s = getState();
  const item = { id: `t${Date.now().toString(36)}`, title, text };
  s.customTexts.unshift(item);
  s.customTexts = s.customTexts.slice(0, 30);
  save();
  return item;
}

export function removeCustomText(id) {
  const s = getState();
  s.customTexts = s.customTexts.filter((t) => t.id !== id);
  save();
}

/**
 * Aggregated pattern statistics over sessions, plus a "recent vs earlier" trend.
 * Returns {id: {opp, err, sus, rate, recentRate, earlierRate, sessions}}
 */
export function aggregatePatterns(sessions) {
  const agg = {};
  const n = sessions.length;
  sessions.forEach((sess, idx) => {
    const recent = idx >= n - 5;
    for (const [id, st] of Object.entries(sess.patternStats || {})) {
      const a = (agg[id] ||= { opp: 0, err: 0, sus: 0, r: { opp: 0, bad: 0 }, e: { opp: 0, bad: 0 }, series: [] });
      a.opp += st.opp;
      a.err += st.err;
      a.sus += st.sus;
      const bucket = recent ? a.r : a.e;
      bucket.opp += st.opp;
      bucket.bad += st.err + 0.5 * st.sus;
      if (st.opp >= 3) a.series.push({ date: sess.date, rate: (st.err + 0.5 * st.sus) / st.opp });
    }
  });
  for (const a of Object.values(agg)) {
    a.rate = a.opp ? (a.err + 0.5 * a.sus) / a.opp : 0;
    a.recentRate = a.r.opp ? a.r.bad / a.r.opp : null;
    a.earlierRate = a.e.opp ? a.e.bad / a.e.opp : null;
  }
  return agg;
}

export function exportData() {
  return JSON.stringify(getState(), null, 2);
}

export function importData(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sessions)) throw new Error("Not an Akcentura backup file");
  state = { ...structuredClone(DEFAULT), ...parsed, settings: { ...DEFAULT.settings, ...(parsed.settings || {}) } };
  save();
}

export function resetAll() {
  state = structuredClone(DEFAULT);
  state.settings.onboarded = false;
  save();
}
