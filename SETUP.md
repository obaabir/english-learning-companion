# English Learning Companion: Setup

A desktop app for learning English from movies: subtitles stream in live from mpv, you click a line, Gemini explains it with your own prompt, and you save it to notes, Google Docs and flashcards.

**Loop:** Watch → Click → Explain → Save → Practice

## 1. Run the app

```bash
npm install
npm run dev
```

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests (database, subtitle cleaning, mpv IPC with a fake mpv, Google Docs formatting) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `out/` |
| `npm run dist` | Windows installer into `dist/` (electron-builder downloads its build tools the first time) |

Your notes, prompts, chats and flashcards are stored in a local SQLite database:
`%APPDATA%\English Learning Companion\english-companion.db`

## 2. Movie player: VLC (default) or mpv

Movie Mode plays films in **VLC** by default. The app starts VLC itself, reads the playback position through VLC's built-in web interface (local only, random port and password), and shows each English subtitle line at the right moment.

1. Install VLC from https://www.videolan.org/ if you don't have it. The app finds it automatically in `C:\Program Files\VideoLAN\VLC\` or `C:\Program Files (x86)\VideoLAN\VLC\`. Otherwise, set the path in **Settings → Movie player**.
2. Always open movies with **Open movie** in the app. A movie opened by double-clicking in File Explorer plays in a VLC the app can't see.
3. To switch movies, just use **Open movie** again. The app closes VLC and reopens it with the new movie, because switching files inside a running VLC can freeze it while a subtitle is on screen.

Where the subtitles come from (VLC mode):
- An `.srt` / `.ass` / `.vtt` file next to the movie whose name starts with the movie's name. English-tagged files like `Movie.en.srt` are preferred.
- Otherwise, the English text subtitle track inside an `.mkv`. It's read in the background, and lines appear within a second.
- Use **Add .srt** to load a subtitle file manually.
- Lines that only describe sounds, such as `[CAT MEOWS]`, are skipped.
- **Image subtitles** (PGS/VobSub) and movies with no English text subtitles show a notice. Load an .srt for that movie instead. OCR support is planned (Phase 4).

**mpv** (optional, in **Settings → Movie player**): a free player that reports the subtitle on screen directly. Download it from https://mpv.io/installation/ and set `mpv.exe` in Settings.

## 3. Gemini API key

1. Create a key at https://aistudio.google.com/apikey
2. Paste it in **Settings → Gemini** and click **Save**. It is stored encrypted with Windows DPAPI.
3. Optional: click **Load models** to pick a different model. The default is `gemini-flash-latest`.

## 4. Google Docs (optional)

Saving notes to Google Docs needs your own Google OAuth client. It takes about 5 minutes, once.

1. Go to https://console.cloud.google.com/ and create a project, e.g. "English Companion".
2. **APIs & Services → Library**: enable **Google Docs API** and **Google Drive API**.
3. **OAuth consent screen** (Google Auth Platform):
   - User type: **External**
   - Fill in the app name and your email.
   - Under **Audience / Test users**, add your own Gmail address.
4. **Clients → Create client → Application type: Desktop app**. Copy the **Client ID** and **Client secret**.
5. In the app, open **Settings → Google account**, paste both, click **Save client**, then **Connect Google** and approve in your browser.
6. Under **Google Docs destinations**, choose or create a doc for each category:
   - **Movie English Notes**: sentences, words, phrases and idioms
   - **Sentence Structure Notes**: anything saved as a sentence structure
   - **IELTS Error Log**: reserved for IELTS mode

Scopes requested: `documents` (append notes to your docs) and `drive.metadata.readonly` (list your docs by name so you can pick one).

> **Weekly reconnect:** while the OAuth app is in **Testing** mode, Google expires the sign-in after 7 days. The app will then ask you to reconnect. To avoid this, set the publishing status to **In production**. Google will show an "unverified app" warning when you sign in, which is fine for personal use.

## How to use it

1. **Movie Mode → Open movie.** Subtitle lines appear on the left as they play. Opening a different movie starts a fresh list.
2. **Click a line** to select it (green tick). It's explained automatically with your selected prompt (turn this off in **Settings → Explanations**). Click a word inside it, or Shift+click a second word, to select a word or phrase.
3. **Side panel (right edge of the Explanation section):** the five actions are **Explain with my prompt**, **Save to Google Docs**, **Chat about this**, **Add to flashcards** and **Save to notes**. Click « to show their names. Saving the same selection twice never creates a duplicate.
4. **Chat** is docked at the bottom of the Explanation section. Click its bar to open or fold it; folding keeps the conversation and your unsent message.
5. The **▾** next to the selected sentence folds its details (source sentence, timestamp, "Save as" type) to save space.
6. **Highlight any text** in an explanation or chat to save it as a **Structure**, **Vocabulary** or **Idiom**, e.g. *"The reason why I chose X was that…"*.
7. **Notes** opens on the movie you're watching. Each movie (identified by its file path) has its own notes and can have its **own Google Doc**: **Choose or create**, then **Save new notes to Doc**. Only notes not already in that doc are added. Each note also has a **My note** box for your own words.
8. **▶ timestamp** on any note reopens the movie at that exact moment.
9. **Flashcards → Generate flashcards** turns your notes into cards. Review with Space, then rate 1–4. Cards are scheduled with spaced repetition (FSRS).
10. **Prompts**: create, edit, duplicate and choose your default explanation prompts.

**Split screen:** the window can shrink to half (or a third) of a laptop screen. Below about 640 px wide, the subtitles move above the explanation, and the left menu shows icons only (hover for names).

**"Gemini is very busy":** Google's servers are sometimes overloaded (error 503). The app retries automatically, then tries a lighter Flash model. If it still fails, press **Try again** a minute later.

## Roadmap

- **Phase 2:** games built from your notes (Sentence Builder, Word Movement Puzzle, Matching, Completion, Choose the Correct Sentence), Easy/Medium/Hard levels, and a grammar structure visualizer.
- **Phase 3:** IELTS mode via a Chrome extension: question tracking, reasoning analysis, an error database with repeated-weakness detection, and automatic saves to the IELTS Error Log doc.
- **Phase 4:** OCR for image and burned-in subtitles, speech-to-text when there are no subtitles, and writing and speaking exercises.
