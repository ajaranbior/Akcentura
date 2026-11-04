import { test } from "node:test";
import assert from "node:assert/strict";
import { g2p, stressIndex, stressPattern, tokenize, wordSimilarity, numberToWords, syllableCount } from "../js/polish.js";

const phones = (w) => g2p(w).map((t) => t.p).join(" ");

test("grapheme-to-phoneme handles Polish digraphs and soft consonants", () => {
  assert.equal(phones("dzień"), "dzi e ni");
  assert.equal(phones("szczęście"), "sz cz en si ci e");
  assert.equal(phones("przy"), "p zh y");
  assert.equal(phones("pies"), "p j e s");
  assert.equal(phones("zima"), "zi i m a");
  assert.equal(phones("chleb"), "x l e b");
});

test("syllables and penultimate stress", () => {
  assert.equal(syllableCount("pieniądze"), 3);
  assert.equal(stressPattern("telefon"), "te-LE-fon");
  assert.equal(stressPattern("uniwersytet"), "u-ni-wer-SY-tet");
  assert.equal(stressIndex("muzyka"), 0); // MU-zy-ka
  assert.equal(stressIndex("byliśmy"), 0); // BY-li-śmy
  assert.equal(stressIndex("kot"), 0);
});

test("tokenize lowercases, strips punctuation and expands numbers", () => {
  assert.deepEqual(tokenize("Ola ma 23 koty!"), ["ola", "ma", "dwadzieścia", "trzy", "koty"]);
  assert.deepEqual(numberToWords(1000), ["tysiąc"]);
});

test("word similarity treats homophone spellings as near-equal", () => {
  assert.equal(wordSimilarity("Kot", "kot"), 1);
  assert.ok(wordSimilarity("morze", "może") >= 0.97);
  assert.ok(wordSimilarity("kot", "kat") < 0.75);
});
