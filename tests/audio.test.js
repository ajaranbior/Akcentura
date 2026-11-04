import { test } from "node:test";
import assert from "node:assert/strict";
import { downsample, detectPitch, estimateFormants, computeFluency } from "../js/audio.js";
import { synthVowel } from "./helpers.js";
import { personalTargets, classifyVowel, POLISH_VOWELS } from "../js/vowellab.js";

test("pitch detection on a synthetic vowel", () => {
  const x = downsample(synthVowel({ f0: 140 }), 4);
  const p = detectPitch(x, 12000);
  assert.ok(Math.abs(p.f0 - 140) < 3, `f0=${p.f0}`);
});

test("formant estimation separates o from a", () => {
  const est = (f1, f2) => estimateFormants(downsample(synthVowel({ f0: 120, formants: [[f1, 80], [f2, 100], [2700, 150]] }), 4).subarray(112), 12000);
  const a = est(750, 1300), o = est(520, 950);
  assert.ok(Math.abs(a.f1 - 750) < 90 && Math.abs(a.f2 - 1300) < 150, JSON.stringify(a));
  assert.ok(Math.abs(o.f1 - 520) < 90 && Math.abs(o.f2 - 950) < 150, JSON.stringify(o));
  const t = personalTargets("male", null);
  assert.equal(classifyVowel(a.f1, a.f2, t).vowel, "a");
  assert.equal(classifyVowel(o.f1, o.f2, t).vowel, "o");
});

test("calibration maps targets onto the speaker's corners", () => {
  const cal = { i: [350, 2700], a: [880, 1550], u: [380, 900] };
  const t = personalTargets("male", cal);
  assert.ok(Math.abs(t.a[0] - 880) < 1 && Math.abs(t.i[1] - 2700) < 1);
  assert.ok(t.o[0] > t.u[0] && t.o[0] < t.a[0]);
  assert.ok(POLISH_VOWELS.female);
});

test("fluency summary from frames", () => {
  const frames = [];
  // 20 s: 1.5 s of speech with syllable-like energy bumps, 0.4 s pauses
  for (let i = 0; i < 1000; i++) {
    const t = i * 0.02;
    const inSpeech = t % 1.9 < 1.5;
    const db = inSpeech ? -30 + 6 * Math.sin(2 * Math.PI * 4.5 * t) : -70;
    frames.push({ t, db, speech: inSpeech, f0: inSpeech ? 110 * Math.pow(2, Math.sin(t) * 3 / 12) : null });
  }
  const f = computeFluency(frames, 0);
  assert.ok(f.rate > 3.5 && f.rate < 5.5, `rate ${f.rate}`);
  assert.ok(f.hesitations >= 8);
  assert.ok(f.score >= 0 && f.score <= 100);
});
