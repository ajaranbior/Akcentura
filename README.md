# Akcentura

### ▶ Open the app: **https://ajaranbior.github.io/Akcentura/**

A mobile-friendly web app that helps you **sound confident and natural in Polish** by listening to you read aloud — from the screen *or from your own paper book*. The feedback is tailored to your native language(s): **Belarusian** and/or **Russian** (pick both if both shaped your accent).

---

## What it does

| | |
|---|---|
| **Read a text** | Pick a sample text, paste one, or upload a `.txt`. Read at your own pace; words light up as they are recognised (clear / fixed on repeat / almost / unclear). Tap any word to hear it. |
| **My book · just listen** | Read from a physical book. The app finds the words you repeat or correct (e.g. *kat → kot*), notes which sound changed, and measures pace, pauses and melody. Afterwards you can paste the page text to get an exact word-by-word score of the same recording. |
| **Repeating is fine** | Repeating a word or a whole sentence until it comes out right is treated as practice, not as an error. The repeats are used to work out *which sounds* you struggle with, and you get credit when the final attempt is clear. |
| **Accent diagnosis** | When the recogniser hears a different word, the app compares the two sound by sound and links the difference to a known Belarusian/Russian → Polish pattern (see below). |
| **Fluency & confidence** | Pace (syllables/s), hesitation pauses, melody range (semitones), voice fading at the end of sentences, rhythm variability. |
| **Practice** | A ranked list of your focus areas, with explanations for *your* native language, how to make the sound, exercises, practice words, **minimal-pair drills** (e.g. *pora / para*, *czy / ci*, *gol / hol*), tongue twisters and a list of your own problem words. |
| **Vowel lab** | A live vowel chart (F1/F2 formants) showing where your vowel lands compared with Polish *i y e a o u*. Calibrate with *i, a, u* and the targets are mapped onto your voice — useful for the narrow Belarusian/Russian *o* vs the open Polish *o*. |
| **Progress** | Score trend, struggle areas with “last 5 readings vs earlier” trend arrows, pace over time, hardest words (mastered after 3 clear tries in a row), session history. |

### Accent patterns tracked

| Pattern | Typical for | Example |
|---|---|---|
| Unstressed **o** → a (akanie) | BE, RU | *woda* → “wada” |
| Open Polish **o** (not narrow / “uo”) | BE, RU | *kot* |
| Clean start of **o/u** (no prothetic w) | BE | *okno* → “wokno” |
| Unstressed **e** after soft consonants (yakanie / ikanie) | BE, RU | *pieniądze* → “piniądze” |
| Hard consonants before **e** (no palatalisation, no dzekanie) | BE, RU | *ten* → “cień”, *temat* → “ciemat” |
| **y** vs **i** | BE, RU | *być / bić* |
| **ł** = w and light **l** | RU, BE | *łata / lata*, dark л in *lato* |
| Hard **cz, sz, ż, szcz** (not soft ч / щ) | RU | *czy* → “ci”, *szczęście* → “щęście” |
| Soft **ś ć ź dź ń** (not сь ть дь) | RU, BE | *ciocia* → “t'ot'a” |
| Nasal **ą ę** | BE, RU | *wąs / was*, *idą / idę* |
| Plosive **g** (not fricative г) | BE | *gol* → “hol” |
| Voiceless **h** | BE | *herbata* with a voiced h |
| **w** → f at syllable end (not ў) | BE | *krew* = “kref” |
| **rz** = ż (reading habit) | BE, RU | *rzeka*, *przy* |
| Penultimate stress | BE, RU | *te-LE-fon*, *u-ni-wer-SY-tet* |

## How it works (and its limits)

* **Speech recognition** uses the browser’s built-in Web Speech API (`pl-PL`). Works in **Chrome, Edge (desktop & Android)** and **Safari (macOS & iOS)**. Firefox has no speech recognition — there you only get the voice analysis and the Vowel lab. In Chrome/Edge the audio is processed by the browser vendor’s speech service, so an internet connection is needed.
* A recogniser is built to *understand* speech, so it forgives a lot. A word it mishears is therefore a strong sign of a real problem, but a word it understood can still have an accent. The **minimal-pair drills** and the **Vowel lab** test single sounds more strictly.
* **Stress and rhythm** can’t be read from the recognised text. The app explains them, flags stress-trap words (Russian/Belarusian cognates) and words you repeat, and measures rhythm from the audio.
* **Voice analysis** (loudness, pitch with the McLeod method, formants with LPC) runs locally in your browser. Some Android phones can’t give the microphone to speech recognition and analysis at the same time; the app notices and switches the analysis off (also available in Settings).
* **Privacy:** there is no server. Readings and progress are stored in your browser’s `localStorage`. Use *Settings → Export backup* to move them to another device.
* Keep the phone near the book; the screen stays on while you read (Wake Lock).

## Development

Plain HTML/CSS/JavaScript (ES modules), no build step and no dependencies.

```bash
npm start      # serves on http://localhost:8080 (python3 -m http.server)
```

```bash
npm test       # node --test: phonology, alignment, diagnosis, DSP
```

```
index.html           app shell
css/styles.css       mobile-first styles, light/dark
js/app.js            UI: read, practice, progress, settings
js/polish.js         tokenizer, Polish grapheme→phoneme, syllables, stress
js/profiles.js       Belarusian/Russian → Polish accent patterns, tips, exercises
js/analyzer.js       alignment with repetitions, sound-level diagnosis, scoring
js/audio.js          pitch, formants, voice activity, fluency metrics
js/recognizer.js     Web Speech API wrapper (auto-restart) + text-to-speech
js/vowellab.js       live vowel chart with calibration
js/storage.js        local persistence and progress aggregation
js/texts.js          sample texts
```

Deployment: every push to `main` runs the tests and publishes the site to the `gh-pages` branch via `.github/workflows/pages.yml`; GitHub Pages serves that branch (**Settings → Pages → Deploy from a branch → `gh-pages` / root**).

### Adding languages

Native languages live in `NATIVE_LANGUAGES` and each pattern in `js/profiles.js` has a `severity` per language (0–3) and a `why` text. Adding e.g. Ukrainian means adding a code there and a severity/explanation per pattern. Target languages other than Polish would need their own phonology module.
