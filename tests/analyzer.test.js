import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, GuidedSession, analyzeFree, collapseRepetitions, recommend } from "../js/analyzer.js";
import { patternsInWord } from "../js/profiles.js";

const ids = (a, b) => diagnose(a, b).map((d) => d.id);

test("diagnose maps sound substitutions to accent patterns", () => {
  assert.deepEqual(ids("pora", "para"), ["akanie"]);
  assert.deepEqual(ids("łata", "lata"), ["l_sounds"]);
  assert.deepEqual(ids("wąs", "was"), ["nasals"]);
  assert.deepEqual(ids("gol", "hol"), ["g_plosive"]);
  assert.deepEqual(ids("być", "bić"), ["y_i"]);
  assert.deepEqual(ids("pieski", "piaski"), ["yakanie"]);
  assert.ok(ids("czy", "ci").includes("cz_hard"));
  assert.ok(ids("ten", "cień").includes("palatal_e"));
  assert.ok(ids("kasia", "kasza").includes("soft_sibilants"));
  assert.deepEqual(ids("kot", "kot"), []);
});

test("patterns depend on the native language", () => {
  assert.ok(patternsInWord("góra", ["be"]).includes("g_plosive"));
  assert.ok(!patternsInWord("góra", ["ru"]).includes("g_plosive"));
  assert.ok(patternsInWord("czas", ["ru"]).includes("cz_hard"));
});

test("guided session aligns repeated sentences and self-corrections", () => {
  const s = new GuidedSession("Ola ma nowy dom obok ogrodu. Potem robi obiad.", ["be"]);
  s.addPhrase("ala ma nowy dom");
  s.addPhrase("ola ma nowy dom abok ogrodu");
  s.addPhrase("obok ogrodu potem robi obiad");
  const ola = s.words[0];
  assert.equal(ola.attempts.length, 2);
  assert.equal(s.wordStatus(ola), "fixed");
  assert.equal(s.wordStatus(s.words[4]), "fixed"); // abok -> obok
  assert.equal(s.maxReached, s.words.length - 1);
  const r = s.report();
  assert.ok(r.patternStats.akanie.err >= 2);
  assert.equal(r.recommendations[0].id, "akanie");
  assert.equal(r.accuracy, 100);
  assert.ok(r.firstTry < 100);
});

test("repetition inside a single phrase counts as two attempts", () => {
  const s = new GuidedSession("Rozmawia z sąsiadką o pogodzie. Potem robi obiad.", ["ru"]);
  s.addPhrase("rozmawia z sąsiadką o pagodzie o pogodzie potem robi obiad");
  const w = s.words.find((x) => x.word === "pogodzie");
  assert.deepEqual(w.attempts.map((a) => a.heard), ["pagodzie", "pogodzie"]);
  assert.equal(s.wordStatus(w), "fixed");
  assert.equal(s.wordStatus(s.words.find((x) => x.word === "potem")), "good");
});

test("going back to an earlier sentence does not break the alignment", () => {
  const s = new GuidedSession("Jest wczesny poranek. Słońce powoli wschodzi nad Wisłą. Ola otwiera okno.", ["be"]);
  s.addPhrase("jest wczesny poranek słońce powoli wschodzi nad wisłą");
  s.addPhrase("słońce powoli wschodzi nad wisłą");
  s.addPhrase("ola otwiera okno");
  assert.equal(s.words[3].attempts.length, 2);
  assert.equal(s.words[s.words.length - 1].attempts.length, 1);
});

test("free reading: repeats collapse and self-corrections are diagnosed", () => {
  const ev = collapseRepetitions(["w", "domu", "było", "w", "domu", "było", "cicho"].map((word) => ({ word })));
  assert.deepEqual(ev.map((e) => e.word), ["w", "domu", "było", "cicho"]);
  const r = analyzeFree([{ text: "był sobie kat kot", confidence: 0.9 }], ["be"]);
  assert.equal(r.patternStats.akanie.err, 1);
  assert.equal(r.struggleWords[0].word, "kot");
  assert.equal(r.clarity, 90);
});

test("recommendations fall back to native-language priors", () => {
  const rec = recommend({}, ["be"]);
  assert.ok(rec.length > 0);
  assert.ok(rec.every((r) => r.err === 0));
});
