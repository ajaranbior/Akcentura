// Knowledge base: typical accent patterns of Russian and Belarusian speakers in Polish.
// Each pattern says how likely it is for a native language (severity 0–3), how to
// spot words that contain the risky sound, and what to practise.

import { g2p, stressIndex, normalizeWord, syllableCount } from "./polish.js";

export const NATIVE_LANGUAGES = {
  be: { name: "Belarusian", native: "Беларуская" },
  ru: { name: "Russian", native: "Русский" },
};

export const TARGET_LANGUAGES = {
  pl: { name: "Polish", native: "Polski", speechLang: "pl-PL" },
};

const HARD_BEFORE_E = new Set(["t", "d", "s", "z", "n", "r", "p", "b", "m", "v", "f", "ts", "dz"]);
const SOFT_CONS = new Set(["si", "zi", "ci", "dzi", "ni", "j", "l"]);

// Russian cognates / internationalisms whose stress differs from Polish.
export const STRESS_TRAPS = new Set([
  "telefon", "uniwersytet", "problem", "problemy", "dokument", "dokumenty", "człowiek", "mleko",
  "ogród", "samochód", "telewizja", "telewizor", "rodzina", "kobieta", "pamiętam", "teatr", "minuta",
  "minuty", "moment", "kolega", "kultura", "historia", "pogoda", "zdrowie", "dobrze", "później",
  "polityka", "muzyka", "matematyka", "fizyka", "gramatyka", "ameryka", "restauracja", "informacja",
  "sytuacja", "nauczyciel", "nauczycielka", "pieniądze", "obiad", "ulica", "miasto", "dziecko",
  "jabłko", "student", "studentka", "instytut", "prezydent", "procent", "adres", "kilometr",
]);

const hasPhone = (toks, set) => toks.some((t) => set.has(t.p));

export const PATTERNS = [
  {
    id: "akanie",
    title: "Unstressed o (akanie)",
    category: "vowels",
    symbol: "o",
    severity: { be: 3, ru: 3 },
    summary: "Polish keeps a full, round o in every syllable — it never turns into a / ə.",
    why: {
      be: "Belarusian writes and says unstressed o as a (вада, малако́). The habit makes Polish woda, dobrze, potem sound like “wada, dabrze, patem”.",
      ru: "Russian reduces unstressed о to [ɐ]/[ə] (молоко́ → məlʌko). In Polish that sounds sloppy or foreign: “karova” instead of krowa.",
    },
    howTo: [
      "Polish has no vowel reduction: say each o as clearly as the stressed one.",
      "Keep the jaw slightly open and the lips gently rounded on every o, also before and after the stress.",
      "Read slowly, syllable by syllable (wo-da, po-tem, ko-lor), then speed up without losing the o.",
    ],
    exercises: [
      "Minimal pairs o/a below: say each pair 3×, the recogniser should hear the right word.",
      "Whisper the phrase first — in a whisper you can feel the lip rounding for every o.",
      "Chain drill: “po-mo-co-wo-do” with a hand on your chin; the jaw should stay steady, not open to a.",
      "Read the sample text “O jak ogród” and aim for a 90%+ first-try score.",
    ],
    practiceWords: ["woda", "dobrze", "potem", "kolor", "robota", "ogromny", "pomoc", "ochota", "pogoda", "obok"],
    minimalPairs: [["pora", "para"], ["woda", "wada"], ["kosa", "kasa"], ["tom", "tam"], ["rok", "rak"], ["los", "las"], ["kot", "kat"]],
    twister: "Ola obok okna obiera ogórki, a Tola kroi pomidory.",
    detect(toks, word, stress) {
      return toks.some((t) => t.p === "o" && t.syl !== stress);
    },
  },
  {
    id: "open_o",
    title: "Open Polish o",
    category: "vowels",
    symbol: "ɔ",
    severity: { be: 2, ru: 2 },
    summary: "Polish o [ɔ] is open and short — not the narrow, almost-u o with a glide.",
    why: {
      be: "Belarusian stressed о is narrower and often starts with a small [u]/[w] glide (вока). In Polish it sounds like u or “uo”.",
      ru: "Russian stressed о is closer and slightly diphthongised ([ᵘo]). Polish o is lower and steadier.",
    },
    howTo: [
      "Drop the jaw a little more than for Russian/Belarusian о — about halfway to a.",
      "Round the lips only loosely; do not push them forward.",
      "Hold the vowel steady: no glide at the start or end.",
    ],
    exercises: [
      "Use the Vowel lab: say “o” and move your dot into the Polish o zone (between u and a).",
      "Ladder: u – o – a – o – u, slowly; feel the jaw move one step each time.",
      "Minimal pairs o/u (bok/buk, kora/kura).",
    ],
    practiceWords: ["kot", "dom", "nos", "most", "brzoza", "szkoła", "pokój", "noc", "sok", "rok"],
    minimalPairs: [["bok", "buk"], ["kora", "kura"]],
    twister: "Kot Tosia to dobry kot, bo co noc łowi myszy.",
    detect(toks, word, stress) {
      return toks.some((t) => t.p === "o" && t.syl === stress);
    },
  },
  {
    id: "prothesis",
    title: "Clean start of o / u",
    category: "vowels",
    symbol: "#o",
    severity: { be: 2, ru: 0 },
    summary: "Words starting with o / u start straight on the vowel: okno, ulica — not “wokno”, “wulica”.",
    why: {
      be: "Belarusian adds в/ў before an initial о/у (вока, вуліца). In Polish this extra w changes the word.",
      ru: "Rare for Russian speakers.",
    },
    howTo: [
      "Shape the lips for o/u first, then start the voice — no movement of the lips while the sound starts.",
      "A very light glottal onset (like a tiny cough) is fine in Polish.",
    ],
    exercises: [
      "Say the word twice: first silently shaping the lips, then aloud from that position.",
      "List: oko, okno, ogród, owoc, ulica, ucho, uczeń, obiad.",
    ],
    practiceWords: ["oko", "okno", "ogród", "owoc", "ośrodek", "ulica", "ucho", "uczeń", "ostatni", "obiad"],
    minimalPairs: [],
    twister: "Uczeń otworzył okno i oglądał ogród.",
    detect(toks) {
      return toks.length > 0 && (toks[0].p === "o" || toks[0].p === "u");
    },
  },
  {
    id: "yakanie",
    title: "Unstressed e after soft consonants",
    category: "vowels",
    symbol: "e",
    severity: { be: 3, ru: 3 },
    summary: "Polish e stays e in every syllable: pieniądze, niedziela — not “piniondze” or “piaśniondze”.",
    why: {
      be: "Belarusian яканне turns unstressed е after soft consonants into а (бяро́за): Polish wiedzieć may come out as “wiadzieć”.",
      ru: "Russian иканье turns unstressed е into [ɪ] (пятно́ → pʲɪtno): Polish pieniądze, mieszkanie sound like “piniądze, miszkanie”.",
    },
    howTo: [
      "Open the mouth to a clear [ɛ] (like in “bed”) every time you see e, stressed or not.",
      "The softness belongs to the consonant before it, the vowel itself stays e.",
    ],
    exercises: [
      "Minimal pairs e/i and e/a (wieje/wije, pieski/piaski).",
      "Read words in slow motion: pie-nią-dze, nie-dzie-la, mie-szka-nie, then normal speed.",
      "Exaggerate: say the word with an over-open e, then relax to normal.",
    ],
    practiceWords: ["pieniądze", "niedziela", "mieszkanie", "wiedzieć", "dziewczyna", "jezioro", "ciekawy", "lekarz", "telefon", "wieczorem"],
    minimalPairs: [["wieje", "wije"], ["pieje", "pije"], ["wiedzą", "widzą"], ["pieski", "piaski"], ["siedzą", "siadą"]],
    twister: "W niedzielę Jerzy liczy pieniądze w ciemnej piwnicy.",
    detect(toks, word, stress) {
      for (let i = 1; i < toks.length; i++) {
        if (toks[i].p === "e" && toks[i].syl !== stress && SOFT_CONS.has(toks[i - 1].p)) return true;
      }
      return false;
    },
  },
  {
    id: "palatal_e",
    title: "Hard consonants before e",
    category: "consonants",
    symbol: "te",
    severity: { be: 3, ru: 2 },
    summary: "In Polish t, d, s, z, n, r, m… stay hard before e: ten, teraz, sen — not “t'en”, “ciemat”.",
    why: {
      be: "Belarusian softens consonants before е and turns soft т/д into ць/дзь (дзеканне): Polish temat, deszcz may sound like “ciemat, dzieszcz”.",
      ru: "Russian always softens consonants before е (тема = tʲema). Polish ten, sen, dobre need a hard consonant.",
    },
    howTo: [
      "Keep the middle of the tongue low when you pronounce t, d, n, s, z before e.",
      "Imagine there is a tiny y-like vowel (ы) between the consonant and the e: t(ы)en.",
    ],
    exercises: [
      "Minimal pairs: ten/cień, sen/sień — the recogniser must hear the hard one.",
      "Say “ta – te – to” several times: the t must sound identical in all three.",
      "Phrase: “Teraz ten temat jest dobry.”",
    ],
    practiceWords: ["ten", "teraz", "temat", "dobre", "sen", "nowe", "deszcz", "rzeka", "serce", "zero"],
    minimalPairs: [["ten", "cień"], ["sen", "sień"], ["zew", "ziew"]],
    twister: "Teraz ten teatr ma dobre recenzje i nowe dekoracje.",
    detect(toks) {
      for (let i = 0; i + 1 < toks.length; i++) {
        if (HARD_BEFORE_E.has(toks[i].p) && toks[i + 1].p === "e") return true;
      }
      return false;
    },
  },
  {
    id: "y_i",
    title: "y versus i",
    category: "vowels",
    symbol: "y",
    severity: { be: 2, ru: 2 },
    summary: "Polish y [ɨ] is lower and more relaxed than Russian ы, and must not be mixed with i: być ≠ bić.",
    why: {
      be: "Belarusian ы is close to Polish y, but i/y spelling after consonants is easy to mix up while reading.",
      ru: "Russian ы is higher and further back, often with a glide; Polish y sounds more like a short “ɨ/ɘ” between i and e.",
    },
    howTo: [
      "Start from i, then pull the tongue slightly back and drop the jaw a bit: that is Polish y.",
      "Never soften the consonant before y (być, ryba, my).",
    ],
    exercises: [
      "Minimal pairs być/bić, był/bił, my/mi.",
      "Alternate: mi – my – mi – my, then bi – by – bi – by.",
      "Vowel lab: compare your y with i and e.",
    ],
    practiceWords: ["być", "ryba", "syn", "wszystko", "kobiety", "dobry", "mysz", "tydzień", "język", "szybko"],
    minimalPairs: [["być", "bić"], ["był", "bił"], ["wyć", "wić"], ["my", "mi"]],
    twister: "Myszy i misie były wczoraj w piwnicy.",
    detect(toks) {
      return toks.some((t) => t.p === "y");
    },
  },
  {
    id: "l_sounds",
    title: "ł and light l",
    category: "consonants",
    symbol: "ł/l",
    severity: { be: 2, ru: 3 },
    summary: "ł is a w-sound (like English “water”); Polish l is always light — never the dark Russian л.",
    why: {
      be: "Belarusian ў helps with ł, but Belarusian hard л is dark: Polish lampa, lato need a light l.",
      ru: "Russian hard л is dark ([ɫ]). Reading ł as л sounds very foreign, and dark l in lato, lubić is an instant accent marker.",
    },
    howTo: [
      "ł: round the lips, do not touch the teeth with the tongue (łyżka = “wyżka”).",
      "l: tip of the tongue behind the upper teeth, the back of the tongue LOW — like the l in “leaf”, also before a, o, u.",
    ],
    exercises: [
      "Minimal pairs łata/lata, łaska/laska.",
      "Say “la-lo-lu” keeping the tongue body down (smile slightly).",
      "Phrase: “Ładna Ala lubi lody latem.”",
    ],
    practiceWords: ["łyżka", "mały", "było", "szkoła", "lato", "lubić", "lampa", "długo", "głowa", "palec"],
    minimalPairs: [["łata", "lata"], ["łaska", "laska"]],
    twister: "Łukasz łowił ładne łososie, a Ala lubi lody latem.",
    detect(toks) {
      return toks.some((t, i) => t.p === "w" || (t.p === "l" && toks[i + 1] && ["a", "o", "u", "y"].includes(toks[i + 1].p)));
    },
  },
  {
    id: "cz_hard",
    title: "Hard cz, sz, ż, szcz",
    category: "consonants",
    symbol: "cz",
    severity: { be: 1, ru: 3 },
    summary: "Polish cz, sz, ż, szcz are hard (tongue tip up, lips slightly rounded) — never the soft Russian ч or щ.",
    why: {
      be: "Belarusian ч and ш are hard already — usually fine, just keep szcz as sz+cz.",
      ru: "Russian ч and щ are soft. Polish czas, szczęście said with ч/щ sound like ć/ś: “ciasz”, “śćęście”.",
    },
    howTo: [
      "Tongue tip up behind the gum ridge, middle of the tongue low, lips a little forward.",
      "szcz is two sounds: sz + cz (sz-czę-ście), not a long щ.",
    ],
    exercises: [
      "Minimal pairs czy/ci, lecz/leć, kasza/Kasia.",
      "Say “sza – cza – ża”, then “sia – cia – zia”: feel two different tongue positions.",
      "Tongue twister: “W Szczebrzeszynie chrząszcz brzmi w trzcinie.”",
    ],
    practiceWords: ["czas", "często", "czytać", "szczęście", "jeszcze", "deszcz", "człowiek", "mieszkać", "życie", "uczeń"],
    minimalPairs: [["czy", "ci"], ["lecz", "leć"], ["płacz", "płać"], ["kasza", "kasa"]],
    twister: "Czy tata czyta cytaty Tacyta?",
    detect(toks) {
      return toks.some((t) => t.p === "cz" || t.p === "dzh" || t.p === "sz" || t.p === "zh");
    },
  },
  {
    id: "soft_sibilants",
    title: "Soft ś, ć, ź, dź, ń",
    category: "consonants",
    symbol: "ś",
    severity: { be: 2, ru: 3 },
    summary: "ś ć ź dź are made with the tongue blade at the hard palate, tip down — not palatalised s', t', d'.",
    why: {
      be: "Belarusian сь/ць/дзь are close, but still made with the tongue tip; Polish ś/ć are flatter and “hissier”.",
      ru: "Russian has no ć/dź: they come out as ть/дь (ciocia → “t'ot'a”, dzień → “d'en'”) and ś as сь.",
    },
    howTo: [
      "Tip of the tongue down behind the lower teeth; raise the middle of the tongue to the hard palate.",
      "Smile slightly; ś sounds like a soft hiss, ć = t+ś in one movement, not a plain t'.",
    ],
    exercises: [
      "Minimal pairs: kasza/Kasia, wiesz/wieś, proszę/prosię.",
      "Hold “śśśś”, then add a t in front: “ćśśś”, shorten to ć.",
      "Phrase: “Cześć, ciociu! Dziś jest dzień dziecka.”",
    ],
    practiceWords: ["ciocia", "dzień", "cześć", "dziś", "siedem", "ziemia", "jesień", "śniadanie", "dziecko", "koń"],
    minimalPairs: [["kasza", "kasia"], ["wiesz", "wieś"], ["proszę", "prosię"]],
    twister: "Dziś ciocia Kasia siedzi w dziesiątym rzędzie.",
    detect(toks) {
      return toks.some((t) => t.p === "si" || t.p === "ci" || t.p === "zi" || t.p === "dzi" || t.p === "ni");
    },
  },
  {
    id: "nasals",
    title: "Nasal vowels ą, ę",
    category: "vowels",
    symbol: "ą",
    severity: { be: 3, ru: 3 },
    summary: "ą / ę are nasal: ręka = “renka”, ząb = “zomp”, wąs = nasal o + w, but final ę ≈ e (idę).",
    why: {
      be: "Belarusian has no nasal vowels, so ą/ę tend to become plain o/e or “on/en” everywhere.",
      ru: "Russian has no nasal vowels, so ą/ę tend to become plain o/e or “on/en” everywhere.",
    },
    howTo: [
      "Before p/b: ą → om, ę → em (dąb, tęp). Before t/d/c/cz: on/en (kąt, będę). Before k/g: oŋ/eŋ (ręka).",
      "Before s, sz, z, ż, f, w, ch: a real nasal vowel ending in a nasal w (wąs, mięso, gęś).",
      "At the end of a word: ę ≈ e (idę, proszę), ą = nasal o+w (idą, z mamą).",
    ],
    exercises: [
      "Minimal pairs wąs/was, męka/mąka, idą/idę.",
      "Hold your nose: for ą/ę before s/sz you should feel the vibration stop.",
      "Phrase: “Idę z mamą po mąkę i mięso.”",
    ],
    practiceWords: ["ręka", "mąka", "pięć", "będę", "wąski", "mięso", "gęś", "idą", "proszę", "dziękuję"],
    minimalPairs: [["wąs", "was"], ["kąt", "kat"], ["męka", "mąka"], ["idą", "idę"]],
    twister: "Gęś gęga, a wąż wąsko się wije między gałęziami.",
    detect(toks) {
      return toks.some((t) => t.p === "on" || t.p === "en");
    },
  },
  {
    id: "g_plosive",
    title: "Plosive g",
    category: "consonants",
    symbol: "g",
    severity: { be: 3, ru: 0 },
    summary: "Polish g is a stop [g] like in “go”, never the Belarusian fricative г [ɣ].",
    why: {
      be: "Belarusian г is a fricative ([ɣ]/[ɦ]). Polish góra, mogę, gdzie need a full stop: the back of the tongue closes and releases.",
      ru: "Russian г is already a stop — usually no problem.",
    },
    howTo: [
      "Close the back of the tongue against the soft palate completely, then release: a short pop.",
      "Compare with k: same place, just add voice.",
    ],
    exercises: [
      "Minimal pairs gol/hol, gala/hala.",
      "Say “ka – ga – ka – ga”: g must have the same pop as k.",
      "Phrase: “Gdzie jest Grzegorz? Gra na gitarze w górach.”",
    ],
    practiceWords: ["góra", "gdzie", "mogę", "noga", "drogi", "gazeta", "grać", "gotować", "długo", "ogród"],
    minimalPairs: [["gol", "hol"], ["gala", "hala"]],
    twister: "Gruby Grzegorz gra na gitarze w górach.",
    detect(toks) {
      return toks.some((t) => t.p === "g");
    },
  },
  {
    id: "h_voiceless",
    title: "Voiceless h / ch",
    category: "consonants",
    symbol: "h",
    severity: { be: 2, ru: 0 },
    summary: "Polish h and ch are the same voiceless sound [x] (like Russian х): herbata = “cherbata”.",
    why: {
      be: "Belarusian reads h as voiced г [ɦ]/[ɣ]: Polish herbata, historia then sound Belarusian.",
      ru: "Russian х works perfectly for Polish h/ch.",
    },
    howTo: [
      "Say h exactly like х in хлеб: no voice, only air friction at the back of the mouth.",
    ],
    exercises: [
      "Whisper the word, then say it aloud keeping the h whispered.",
      "Words: herbata, historia, hotel, chleb, chodzić, muchy.",
    ],
    practiceWords: ["herbata", "historia", "hotel", "chleb", "chodzić", "honor", "hałas", "duch", "ucho", "mucha"],
    minimalPairs: [["hol", "gol"], ["hala", "gala"]],
    twister: "Hania ma herbatę, chleb i chałwę.",
    detect(toks) {
      return toks.some((t) => t.p === "x" && t.letters === "h");
    },
  },
  {
    id: "w_final",
    title: "w at the end of a syllable",
    category: "consonants",
    symbol: "w",
    severity: { be: 2, ru: 0 },
    summary: "Polish w before voiceless consonants and at the end of words becomes f: krew = “kref”, wszystko = “fszystko”.",
    why: {
      be: "Belarusian turns в into ў at the end of a syllable (кроў). In Polish krew, Lwów, wtorek need a real f.",
      ru: "Russian devoices в → ф the same way — usually fine.",
    },
    howTo: [
      "Upper teeth touch the lower lip: f, not a rounded w.",
    ],
    exercises: [
      "Words: krew, Lwów, wtorek, wszystko, wczoraj, rękaw.",
      "Say “kref – krew” — they should sound identical.",
    ],
    practiceWords: ["krew", "wtorek", "wszystko", "wczoraj", "Lwów", "rękaw", "brew", "wpół", "wkrótce", "wstać"],
    minimalPairs: [],
    twister: "We wtorek wszystko wcześnie wstało.",
    detect(toks) {
      const VOICELESS = new Set(["p", "t", "k", "f", "s", "sz", "si", "ci", "cz", "ts", "x"]);
      return toks.some((t, i) => t.p === "v" && (i === toks.length - 1 || VOICELESS.has(toks[i + 1].p)));
    },
  },
  {
    id: "rz_spelling",
    title: "rz = ż",
    category: "reading",
    symbol: "rz",
    severity: { be: 1, ru: 1 },
    summary: "rz is one sound, the same as ż (after p, t, k, ch it is sz): rzeka, przy, trzy — never r+ż.",
    why: {
      be: "When reading quickly from a book it is easy to pronounce the spelling: “r-żeka”.",
      ru: "When reading quickly from a book it is easy to pronounce the spelling: “r-żeka”.",
    },
    howTo: ["Read rz as ż; in przy, trzy, krzesło, chrzan it is voiceless sz."],
    exercises: ["Words: rzeka, morze, przy, trzy, krzesło, przepraszam.", "Homophones: morze = może, rzucić = żucić (in sound)."],
    practiceWords: ["rzeka", "morze", "przy", "trzy", "krzesło", "przepraszam", "dobrze", "rzecz", "przez", "brzeg"],
    minimalPairs: [],
    twister: "Trzy krzesła przy brzegu rzeki.",
    detect(toks) {
      return toks.some((t) => t.p === "zh" && t.letters === "rz");
    },
  },
  {
    id: "stress",
    title: "Penultimate stress",
    category: "prosody",
    symbol: "ˈ",
    severity: { be: 3, ru: 3 },
    summary: "Polish stresses the second-to-last syllable: te-LE-fon, sa-MO-chód, u-ni-wer-SY-tet.",
    why: {
      be: "Belarusian stress is free and similar words carry it elsewhere (тэлефо́н). Stress also moves in Polish when the word grows: SA-mo-chód → sa-mo-CHO-dem.",
      ru: "Russian stress is free: телефо́н, университе́т, челове́к. Polish moves it to the penultimate: te-LE-fon, CZŁO-wiek.",
    },
    howTo: [
      "Count syllables from the end: stress the second one from the right.",
      "Exceptions: -liśmy/-iście verb forms (BY-liś-my) and Greek -yka/-ika words (MU-zy-ka).",
      "Stressed Polish syllables are only slightly louder — the other vowels stay full and clear.",
    ],
    exercises: [
      "Tap the table on the stressed syllable while reading a sentence.",
      "Hum the rhythm first (da-DA-da), then say the word.",
      "Stress shift drill: pa-MIĘ-tam → pa-mię-TA-my, SA-mo-chód → sa-mo-CHO-dy.",
    ],
    practiceWords: ["telefon", "uniwersytet", "człowiek", "samochód", "problem", "dokument", "pamiętamy", "kobieta", "ogród", "telewizja"],
    minimalPairs: [],
    twister: "Człowiek z telefonem jechał samochodem na uniwersytet.",
    detect(toks, word) {
      return STRESS_TRAPS.has(normalizeWord(word)) || syllableCount(word) >= 4;
    },
  },
];

export const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

export const CATEGORY_LABELS = {
  vowels: "Vowels",
  consonants: "Consonants",
  prosody: "Stress & rhythm",
  reading: "Reading habits",
};

/** Highest severity of a pattern among the selected native languages. */
export function severityFor(pattern, nativeLangs) {
  return Math.max(0, ...nativeLangs.map((l) => pattern.severity[l] ?? 0));
}

export function relevantPatterns(nativeLangs) {
  return PATTERNS.filter((p) => severityFor(p, nativeLangs) > 0);
}

/** Explanation tailored to the selected native languages. */
export function whyFor(pattern, nativeLangs) {
  return nativeLangs
    .filter((l) => (pattern.severity[l] ?? 0) > 0 && pattern.why[l])
    .map((l) => ({ lang: l, text: pattern.why[l] }));
}

/** Pattern ids present in a word (only those relevant to the learner). */
export function patternsInWord(word, nativeLangs) {
  const toks = g2p(word);
  const stress = stressIndex(word);
  const ids = [];
  for (const p of PATTERNS) {
    if (severityFor(p, nativeLangs) <= 0) continue;
    if (p.detect(toks, word, stress)) ids.push(p.id);
  }
  return ids;
}

// Fluency (whole-reading) feedback tips, keyed by metric.
export const FLUENCY_TIPS = {
  rate: {
    title: "Speaking pace",
    low: "You read quite slowly. Re-read the same paragraph 3 times: the 3rd time aim for a natural pace — familiarity makes speech sound confident.",
    high: "You read fast; make sure every vowel stays full — Polish does not swallow syllables.",
  },
  pauses: {
    title: "Hesitation pauses",
    high: "Many short stops inside sentences. Before reading a sentence aloud, scan it silently and mark where to breathe (commas, after the subject). Pause only there.",
  },
  pitch: {
    title: "Melody",
    low: "Your voice is fairly flat. Polish statements fall at the end, questions without a question word rise. Try “shadowing”: play the sentence (🔊), then imitate its melody.",
  },
  trailing: {
    title: "Ending sentences",
    high: "Your voice often fades at the end of sentences. Keep the volume up to the last syllable — it is what makes you sound confident.",
  },
  rhythm: {
    title: "Rhythm",
    low: "Your syllable lengths vary a lot (typical when unstressed vowels get reduced). Read a line to a slow, steady beat — one syllable per beat — then speed up.",
  },
};
