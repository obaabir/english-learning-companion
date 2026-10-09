# Watch & Learn (YouTube + Podcast): Plan for approval

Status: **plan only. No code until you approve.** Everything below must stay **free (no credit card)**.

## 0. Two facts that change the brief

1. **The app is a Windows desktop app (Electron), not a phone app or website.** The brief describes a mobile product for many Bangladeshi learners: premium tiers, bKash/Nagad, explanations shared between "any user", offline phones. That needs servers, accounts and payments. None of that exists today, and running it for other people won't stay free.
   **Recommendation:** build Watch & Learn first as a new page **inside your desktop app, for you**. Every feature below works there for free. Product-only parts (accounts, payments, shared cache, mobile) are kept as a later, separate decision (§5, Phase 4).
2. **YouTube captions can't be downloaded through YouTube's official API unless you own the video.** The official API (`captions.download`) only works for videos you can edit. Tools that pull captions from other people's videos use unofficial endpoints, which break YouTube's Terms of Service. That's fine to *discuss*, but I won't build it without a legal/ToS decision from you (§3).
   **Free, allowed alternative:** Google's own **Gemini API accepts a public YouTube link** and can transcribe it (your existing free Gemini key). The result is an *AI transcript*, labelled "AI transcript — may contain errors", never presented as official captions.

## 1. User flow

**First time**
1. Open **Watch & Learn** → short intro (3 cards: paste link → tap a line → practice), then pick a **level** (Beginner / Intermediate / IELTS / Job interview) and **explanation language** (Bangla / Banglish / Simple English).
2. Paste a YouTube or podcast link → the app checks it and shows: title, channel, length, transcript source (Official captions / Podcast's own transcript / AI transcript / none), and an estimated difficulty.
3. Press **Start** → the player sits on top; the transcript panel sits **below** it (never over the player).
4. Tap a word or line → Explain (Bangla meaning, examples, "Why couldn't I hear this?") → **Save**.
5. At the end → a 5-question listening quiz → saved lines become review cards.

**Returning**
- Home shows: **Continue watching** (resumes at the last timestamp), **Due for review** (spaced-repetition cards), recent videos, streak and minutes.
- Pasting a link that was already processed loads its transcript and explanations instantly from local storage.

## 2. Data model (SQLite, extends the current database)

| Table | Key fields |
|---|---|
| `media_items` | id, kind (`youtube` / `podcast` / `file` / `movie`), url, title, channel, duration_sec, level_estimate, transcript_source (`official` / `podcast_transcript` / `ai` / `none`), added_at, last_position_sec |
| `transcript_lines` | id, media_id, idx, start_sec, end_sec, text, speaker? |
| `explanation_cache` | key = hash(media_id + line_idx + word? + mode + language + level + model), content_md, created_at. Repeat taps cost nothing. |
| `notes` *(exists)* | + media_id, + line_idx. Notes keep video link + timestamp (`media_path` holds the URL for online media). |
| `cards` *(flashcards exist)* | + media_id, + start_sec/end_sec, so a card replays that exact moment in the embedded player. |
| `dictation_attempts` | id, media_id, line_idx, typed, score, created_at |
| `listening_stats` | date, minutes_listened, lines_saved, lines_understood_hidden, lines_attempted_hidden |

## 3. Caption pipeline (built for failure)

Order tried for each link:

1. **YouTube official captions:** only if the video belongs to the signed-in user (official API). Usually not possible.
2. **Podcast's own transcript:** many podcasts publish one in their RSS feed (`podcast:transcript`, SRT/VTT/JSON). Free and allowed.
3. **AI transcript (Gemini):**
   - *YouTube:* send the public link to the Gemini API, which watches/listens to it on Google's side; ask for timestamped lines. Labelled "AI transcript — may contain errors".
   - *Podcast:* the episode's public audio file (RSS enclosure) → Gemini audio transcription. If that's ever not allowed, use a free offline model on your laptop instead (whisper.cpp).
   - *Your own file:* offline transcription.
4. **None available:** say so plainly ("No transcript could be made for this video") and suggest videos from the curated library. **A transcript is never invented.**

**Validation and labels:** each line keeps its source; AI lines carry the "may contain errors" badge. Timestamps are checked to be in order; gaps over 30 s are flagged.

**Needs a legal/ToS decision from you**
- Using unofficial YouTube caption endpoints (**not recommended**, breaks YouTube's Terms).
- Sending podcast audio to Gemini (check each podcast's terms; personal study use is low risk).
- Free Gemini tier: Google may use the inputs to improve its products. Fine for public videos, but worth knowing.
- YouTube player rules: official IFrame player only, nothing drawn over it or its ads, no background play, no audio extraction. The design follows all of these.

## 4. Screens (desktop now, phone-friendly layout later)

1. **Library / Home:** a paste-link box at the top, Continue watching, Due for review, curated starter library (filter by level and accent: American / British / Australian / South Asian).
2. **Link check sheet:** title, channel, duration, transcript source badge, difficulty, Start button.
3. **Player screen:**
   - Embedded YouTube player (or podcast audio player) at the top.
   - **Line controls bar:** replay line, loop line, A–B repeat, speed 0.5×–1×, auto-pause after each line.
   - **Subtitle mode:** English / English + Bangla / Hidden / Tap-to-reveal.
   - **Transcript panel below:** the current line is highlighted; tap a line to jump; tap a word to explain it.
4. **Explain sheet:**
   - **Word:** Bangla meaning in context, part of speech, pronunciation, one example.
   - **Line:** simple meaning, grammar point, idioms/slang, culture notes.
   - **Why couldn't I hear this?:** written vs. how it sounds (e.g. *going to* → "gonna").
   - Language and level toggles; **Save**.
5. **Chat:** the existing chat, knowing the video, the current timestamp and your level.
6. **Dictation:** line hidden → type what you heard → word-by-word comparison.
7. **Quiz:** 5 questions (gist + detail, IELTS-listening style) from the transcript.
8. **Progress:** minutes, lines saved, streak, "% understood without subtitles".

## 5. Phases

| Phase | Scope | Free? |
|---|---|---|
| **1. MVP** | Paste YouTube link → checks + info → official player → AI or podcast transcript below the player → tap word/line to explain (with cache) → save note with link + timestamp → chat knows the video | ✅ |
| **2. Listening tools** | Replay / loop / A–B / speed / auto-pause, subtitle modes, "Why couldn't I hear this?", dictation, quiz, cards that replay the exact moment, progress stats | ✅ |
| **3. Podcasts and files** | RSS feeds, episode list, podcast transcripts, offline transcription for files | ✅ |
| **4. Product (separate decision)** | Mobile/web app, accounts, shared explanation cache, pre-generated popular videos, premium tier, bKash/Nagad | ⚠️ needs hosting and payments, so not free; out of scope until you decide |

## 6. Risks and open questions

**Risks**
- AI transcripts can be wrong or have drifting timestamps. They're labelled, and lines can be re-checked.
- Gemini free-tier limits (requests per day, video length per day) may block long videos on heavy days.
- Some videos are blocked from embedding by their owners, so they can't be played in the app.
- YouTube or Gemini rules can change.

**Questions for you**
1. Build it **inside the desktop app for you** first (recommended), or do you want the mobile/multi-user product now? (The second isn't free.)
2. Are **AI transcripts (Gemini)** acceptable, given official YouTube captions can't be fetched for other people's videos?
3. Phase 1 first, exactly as listed?
