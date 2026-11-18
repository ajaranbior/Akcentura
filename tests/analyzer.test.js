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

test("final ę is pronounced e: dziękuje / dziękuję are not a nasal error", async () => {
  const { wordSimilarity } = await import("../js/polish.js");
  assert.ok(wordSimilarity("dziękuje", "dziękuję") >= 0.97);
  assert.ok(wordSimilarity("idę", "ide") >= 0.97);
  assert.ok(wordSimilarity("idą", "ido") < 0.97); // final ą stays nasal
  assert.deepEqual(ids("dziękuje", "dziękuję"), []);
  assert.ok(!patternsInWord("proszę", ["ru"]).includes("nasals"));
  assert.ok(patternsInWord("ręka", ["ru"]).includes("nasals"));
});

test("a different ending vowel is an ending issue, not a nasal one", () => {
  assert.deepEqual(ids("sasza", "saszę"), ["endings"]);
  assert.deepEqual(ids("robota", "roboty"), ["endings"]);
  assert.deepEqual(ids("kot", "kat"), ["akanie"]);
  assert.deepEqual(ids("idą", "idę"), ["nasals"]);
});

test("recommendations separate findings from general tips", () => {
  const s = new GuidedSession("Ola ma nowy dom obok ogrodu.", ["be"]);
  s.addPhrase("ala ma nowy dom abok ogrodu");
  const r = s.report();
  const found = r.recommendations.filter((x) => x.found);
  assert.equal(found[0].id, "akanie");
  assert.match(found[0].reason, /In this reading/);
  const general = r.recommendations.filter((x) => !x.found);
  assert.ok(general.length > 0 && general.every((x) => /general tip/.test(x.reason)));
  // IPA sound map: the o in Ola and obok came out as a
  assert.equal(r.phonemeStats.o.err, 2);
  assert.ok(r.phonemeStats.o.as.a >= 1);
  assert.equal(r.phonemeStats.m.err, 0);
});
