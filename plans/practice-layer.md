# Practice layer (Repeat ×N / Speak ×N): Check results and design for approval

Status: **design only. No app code until you approve.** Must stay **free**, with **no audio uploaded or stored**.

## 1. What works in this app (measured on your laptop, 9 Oct 2026)

The app isn't a Claude artifact: it's a **Windows desktop app (Electron, Chromium 152)**.

| Capability | Result | What it means |
|---|---|---|
| Microphone (`getUserMedia`) | ✅ available (input device found) | Recording works |
| Recording + playback (`MediaRecorder`) | ✅ available | "Play my attempt after the original" works, kept in memory only |
| Speech recognition (`SpeechRecognition`) | ⚠️ the object exists, but desktop apps usually get a **"network" error**, because Chrome's version uses Google servers only Chrome itself may call | Probably **not usable**. Confirm with the test below. |
| Text-to-speech (`speechSynthesis`) | ⚠️ exists but **0 voices** visible to the app, although Windows has **Microsoft David** and **Microsoft Zira** (en-US) installed | Use the Windows voices through the app's backend instead (free, offline) |

**Tiny test you can run first** (separate tool; changes nothing in the app):

```
npx electron tools/speech-check.cjs
```

It has three buttons: test the microphone (records 3 s and plays it back), test speech recognition (say "I should have told you earlier"), and test voices.

**Free plan if speech recognition fails (expected)**
- **Recommended: offline speech recognition with Vosk.** Free and open source (Apache-2.0), runs on your laptop, no internet, gives word-by-word results with timing. One-time download of the small English model (about 40–50 MB).
- Option: whisper.cpp (free, more accurate, heavier and slower on a laptop).
- Not recommended: Gemini audio (free tier, but your voice would be uploaded, which breaks "do not upload audio").

Honest wording everywhere: **"The app understood these words"**, never "perfect pronunciation".

## 2. Layout

**Every subtitle line** (desktop) gets three small buttons, shown on hover or when the line is selected:
`Explain` (unchanged) · `🔁 ×5` (Repeat) · `🎤 ×5` (Speak). The count chips are 2 / 5 / 8 / 10, and the app remembers your last choice.

**Repeat bar** (appears above the subtitle list while repeating):
`Repeating 3/5 · Smart ☐ · ⏭ Skip · ⏹ Stop`

**Speak panel** (slides in from the right on desktop; a bottom sheet on a phone layout):
- The line text, with each word lighting up as it's recognised
- Pronunciation line: IPA (from the free CMU dictionary) plus a simple Bangla hint
- `▶ Listen` (replays the original moment in VLC/mpv; falls back to a Windows voice)
- Attempt dots ●●○○○ and a big `🎤 Speak` button
- After each attempt: words heard in **green**, not heard in **grey**; "Retry grey words"; `▶ Original` then `▶ Me`
- Last attempt: the text is hidden ("Say it from memory")
- Bangla sound-trap tips (e.g. **v/w**, **f**, **z**, **th**, short vs. long vowels, word stress), one Bangla line each
- **Self-check mode** if the mic or recognition is unavailable: say the line → ✓ after each rep → rate Easy / OK / Hard, with a one-line reason why the mic isn't available

## 3. State design

**Player interface** (works with VLC, mpv, and later YouTube): `play()`, `pause()`, `seek(sec)`, `currentTime()`, `setRate(r)`, `setSubtitlesVisible(bool)`.

**RepeatSession**

```
idle → playing(rep i/N) → (segment end reached) → next rep | done
state: { lineId, start-0.4s, end+0.4s, total N, current i, smart: bool, plan: Rep[] }
Rep = { rate: 1 | 0.75, subtitles: shown | hidden }
smart plan (N=5): [1×+subs, 0.75×+subs, 0.75×−subs, 1×−subs, 1×−subs]
Stop → idle (restore speed and subtitles) · Skip → next rep
```

- End of segment is detected from the player's time (VLC is polled every 100 ms in this mode; mpv reports time precisely).
- VLC seeks are whole-second, so the app seeks by position fraction for sub-second accuracy (as playback time already does).

**SpeakSession**

```
idle → ready(attempt k/N) → listening → result → ready(k+1) … → memory attempt → done
state: { lineId, words[], N, k, attempts: { heard: bool[], rating? }[], mode: mic | selfcheck, recordingUrl? (memory only) }
```

**Progress** (local): lines practised, listen reps, speak reps, lines rated Hard → **review list** (feeds Flashcards).

## 4. Then the code

After you approve, it's built as a **separate module** (`src/renderer/src/features/practice/*`, plus a small player-control addition and the Vosk/voice service in the backend). The existing Explain, Notes, Chat and layout stay unchanged, except for adding the two buttons to each subtitle line.

## Questions for you

1. Run `npx electron tools/speech-check.cjs`: does test 2 (speech recognition) work or fail?
2. If it fails: is the **free offline Vosk** recognizer (one-time ~45 MB download) OK?
3. OK to use the **Windows voices (David / Zira)** for the "Listen" fallback?
