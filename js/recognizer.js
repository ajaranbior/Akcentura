// Thin wrapper around the Web Speech API (SpeechRecognition) for long,
// continuous reading sessions: auto-restarts when the browser stops listening
// and removes the duplicated text some Android builds emit.

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const speechRecognitionSupported = !!SR;

export class ContinuousRecognizer {
  constructor({ lang = "pl-PL", onFinal, onInterim, onError, onState } = {}) {
    this.lang = lang;
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onError = onError || (() => {});
    this.onState = onState || (() => {});
    this.active = false;
    this.lastFinal = "";
  }

  start() {
    if (!SR) throw new Error("Speech recognition is not supported in this browser");
    this.active = true;
    this.failures = 0;
    this._spawn();
  }

  _spawn() {
    const rec = new SR();
    this.rec = rec;
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.lastFinal = "";
    rec.onstart = () => this.onState("listening");
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (res.isFinal) {
          let text = (alt.transcript || "").trim();
          // Android Chrome sometimes repeats everything recognised so far
          if (this.lastFinal && text.toLowerCase().startsWith(this.lastFinal.toLowerCase())) {
            text = text.slice(this.lastFinal.length).trim();
            this.lastFinal = (alt.transcript || "").trim();
          } else {
            this.lastFinal = text;
          }
          if (text) this.onFinal({ text, confidence: alt.confidence || 0, time: Date.now() });
          this.failures = 0;
        } else {
          interim += alt.transcript;
        }
      }
      this.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture" || e.error === "language-not-supported") {
        this.active = false;
      }
      this.onError(e.error);
    };
    rec.onend = () => {
      this.onInterim("");
      if (!this.active) { this.onState("stopped"); return; }
      this.failures++;
      if (this.failures > 25) { this.active = false; this.onError("restart-loop"); this.onState("stopped"); return; }
      setTimeout(() => { if (this.active) this._spawn(); }, 150);
    };
    try {
      rec.start();
    } catch (err) {
      this.onError(String(err && err.message ? err.message : err));
    }
  }

  stop() {
    this.active = false;
    try { this.rec && this.rec.stop(); } catch { /* ignore */ }
  }
}

/** One-shot recognition of a short utterance (drills). Resolves to array of alternatives. */
export function recognizeOnce(lang = "pl-PL", timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    if (!SR) { reject(new Error("unsupported")); return; }
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    let done = false;
    const finish = (val, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { rec.abort(); } catch { /* ignore */ }
      if (err) reject(err); else resolve(val);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    rec.onresult = (e) => {
      const res = e.results[0];
      const alts = [];
      for (let i = 0; i < res.length; i++) alts.push({ text: res[i].transcript.trim(), confidence: res[i].confidence || 0 });
      finish(alts);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") finish([]);
      else finish(null, new Error(e.error));
    };
    rec.onend = () => finish([]);
    rec.start();
  });
}

// ---------------------------------------------------------------------------
// Text to speech (model pronunciation)
// ---------------------------------------------------------------------------

let polishVoice = null;
function pickVoice() {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices();
  polishVoice = voices.find((v) => /^pl(-|_|$)/i.test(v.lang) && /google|natural|online/i.test(v.name))
    || voices.find((v) => /^pl(-|_|$)/i.test(v.lang)) || null;
  return polishVoice;
}
if (typeof speechSynthesis !== "undefined") {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export const ttsSupported = typeof speechSynthesis !== "undefined";

export function hasPolishVoice() {
  return !!(polishVoice || pickVoice());
}

export function speak(text, rate = 0.9) {
  if (!ttsSupported) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pl-PL";
  if (polishVoice || pickVoice()) u.voice = polishVoice;
  u.rate = rate;
  speechSynthesis.speak(u);
}
