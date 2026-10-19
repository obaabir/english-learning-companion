import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { noteDedupeKey, sourceTypeOf, type NoteKind } from '@shared/types'

export const SEED_PROMPTS: { name: string; instruction: string; isDefault?: boolean }[] = [
  {
    name: 'Bangla Explanation',
    isDefault: true,
    instruction: `You are my English teacher. I am a Bangla speaker learning English from movies and conversations.

For the English text I give you:
1. Translate it into natural, everyday Bangla (not word-for-word).
2. Explain the meaning in simple English.
3. Identify important vocabulary, idioms, phrasal verbs, collocations and grammar structures. Explain when and how each is used, including tone (formal, casual, rude, friendly).
4. Give 3-4 natural example sentences that reuse the key items, each with a Bangla translation.

Keep explanations short and clear. Use headings and bullet points.`
  },
  {
    name: 'IELTS Tutor',
    instruction: `Act as my IELTS tutor (target Band 8).

Analyze the English text I give you from an IELTS perspective:
- Useful Band 7-8 vocabulary and collocations I can reuse.
- Natural sentence structures and grammar patterns worth copying.
- How I could adapt this language in IELTS Speaking (Parts 1-3) and Writing (Task 1/Task 2), with a short model sentence for each.
- Any informal language I should avoid in Writing, with a formal alternative.

Add a short Bangla gloss for difficult words. Be concise and practical.`
  },
  {
    name: 'Vocabulary Analysis',
    instruction: `Focus only on vocabulary in the English text I give you.
For each useful word, phrase, idiom or phrasal verb: give the meaning in simple English, the Bangla meaning, the part of speech, common collocations, register (formal/informal) and two natural example sentences with Bangla translations.
Skip very basic words.`
  },
  {
    name: 'Grammar Analysis',
    instruction: `Explain the grammar of the English text I give you.
Break the sentence into its parts (subject, verb, object, complement, clauses, phrases, time/place/manner expressions). Name the tense and any structures (conditionals, modals, relative clauses, passive, reported speech, inversion, etc.).
Explain WHY the sentence is built this way, in simple English with short Bangla notes. Then give 3 new sentences using the same structure.`
  },
  {
    name: 'Sentence Structure Analysis',
    instruction: `Extract the reusable sentence pattern(s) from the English text I give you.
Write each pattern as a template (e.g. "The reason why I ___ was that ___"), explain when to use it, its tone, and give 4 example sentences on everyday and IELTS topics with Bangla translations.`
  }
]

const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  (db) => {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        instruction TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        context_sentence TEXT,
        explanation_md TEXT,
        data_json TEXT,
        media_path TEXT,
        media_title TEXT,
        timestamp_sec REAL,
        prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL,
        gdoc_id TEXT,
        gdoc_synced_at TEXT,
        gdoc_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX notes_kind ON notes(kind);
      CREATE INDEX notes_media ON notes(media_title);

      CREATE TABLE chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL,
        context_text TEXT,
        context_sentence TEXT,
        media_path TEXT,
        media_title TEXT,
        timestamp_sec REAL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','model')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX chat_messages_chat ON chat_messages(chat_id);

      CREATE TABLE flashcards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        front TEXT NOT NULL,
        back_json TEXT NOT NULL,
        card_json TEXT NOT NULL,
        due TEXT NOT NULL,
        state INTEGER NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX flashcards_due ON flashcards(due);
      CREATE INDEX flashcards_note ON flashcards(note_id);

      CREATE TABLE flashcard_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        flashcard_id INTEGER NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL,
        reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE doc_targets (
        category TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        title TEXT NOT NULL
      );
    `)
    const insert = db.prepare('INSERT INTO prompts (name, instruction, is_default) VALUES (?, ?, ?)')
    for (const p of SEED_PROMPTS) insert.run(p.name, p.instruction, p.isDefault ? 1 : 0)
  },
  // v2: the learner's own note on each saved item, and one Google Doc per movie.
  (db) => {
    db.exec(`
      ALTER TABLE notes ADD COLUMN user_note TEXT;
      CREATE INDEX notes_media_path ON notes(media_path);

      CREATE TABLE movie_docs (
        media_path TEXT PRIMARY KEY,
        media_title TEXT,
        doc_id TEXT NOT NULL,
        doc_title TEXT NOT NULL
      );
    `)
  },
  // v3: YouTube videos and their (AI) transcripts, so each video is transcribed only once.
  (db) => {
    db.exec(`
      CREATE TABLE youtube_videos (
        video_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        thumbnail_url TEXT,
        duration_sec REAL,
        transcript_source TEXT,
        transcript_json TEXT NOT NULL DEFAULT '[]',
        chunks_done INTEGER NOT NULL DEFAULT 0,
        transcript_complete INTEGER NOT NULL DEFAULT 0,
        level TEXT,
        last_position_sec REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `)
  },
  // v4: Practice layer progress (listen/speak reps and ratings per subtitle line).
  (db) => {
    db.exec(`
      CREATE TABLE practice_lines (
        line_key TEXT PRIMARY KEY,
        media_path TEXT,
        media_title TEXT,
        start_sec REAL,
        end_sec REAL,
        text TEXT NOT NULL,
        listen_reps INTEGER NOT NULL DEFAULT 0,
        speak_reps INTEGER NOT NULL DEFAULT 0,
        rating TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `)
  },
  // v5: Practice Room (shadowed lines with spaced reviews, daily activity, remix sets).
  (db) => {
    db.exec(`
      CREATE TABLE shadow_lines (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        next_due TEXT,
        date_shadowed TEXT NOT NULL
      );
      CREATE INDEX shadow_lines_due ON shadow_lines(next_due);
      CREATE INDEX shadow_lines_day ON shadow_lines(date_shadowed);

      CREATE TABLE practice_activity (
        day TEXT PRIMARY KEY,
        shadowed INTEGER NOT NULL DEFAULT 0,
        reviewed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE remix_sets (
        day TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
    `)
  },
  // Chat questions remember the text the learner had highlighted (JSON ChatFocus).
  (db) => {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN focus_json TEXT;`)
  },
  // Articles: reading history with a copy of the original text, visits per day, and notes linked to them.
  (db) => {
    db.exec(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        site_name TEXT,
        byline TEXT,
        excerpt TEXT,
        blocks_json TEXT,
        personal_note TEXT,
        first_opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      ALTER TABLE notes ADD COLUMN article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL;
      CREATE INDEX notes_article ON notes(article_id);
    `)
  },
  // Learning records: a stable ID per item, its source (article / movie / YouTube / IELTS question),
  // a key that detects repeated saves, and a marker for Google Docs appends whose result is unknown.
  // Google Docs gets one destination per category; the old "movie" doc keeps receiving everything it
  // received before until a different doc is chosen.
  (db) => {
    db.exec(`
      ALTER TABLE notes ADD COLUMN uid TEXT;
      ALTER TABLE notes ADD COLUMN source_type TEXT;
      ALTER TABLE notes ADD COLUMN source_url TEXT;
      ALTER TABLE notes ADD COLUMN ielts_ref TEXT;
      ALTER TABLE notes ADD COLUMN dedupe_key TEXT;
      ALTER TABLE notes ADD COLUMN gdoc_attempt_at TEXT;
    `)
    const rows = db
      .prepare('SELECT n.id, n.kind, n.text, n.context_sentence, n.media_path, n.article_id, a.url AS article_url FROM notes n LEFT JOIN articles a ON a.id = n.article_id')
      .all() as { id: number; kind: NoteKind; text: string; context_sentence: string | null; media_path: string | null; article_id: number | null; article_url: string | null }[]
    const update = db.prepare('UPDATE notes SET uid = ?, source_type = ?, source_url = ?, dedupe_key = ? WHERE id = ?')
    for (const r of rows) {
      const n = { kind: r.kind, text: r.text, contextSentence: r.context_sentence, mediaPath: r.media_path, articleId: r.article_id }
      const url = r.article_url ?? (r.media_path && /^https?:\/\//.test(r.media_path) ? r.media_path : null)
      update.run(randomUUID(), sourceTypeOf(n), url, noteDedupeKey(n), r.id)
    }
    db.exec(`
      CREATE UNIQUE INDEX notes_uid ON notes(uid);
      CREATE INDEX notes_dedupe ON notes(dedupe_key);
    `)
    const movie = db.prepare("SELECT doc_id, title FROM doc_targets WHERE category = 'movie'").get() as { doc_id: string; title: string } | undefined
    if (movie) {
      const copy = db.prepare('INSERT OR IGNORE INTO doc_targets (category, doc_id, title) VALUES (?, ?, ?)')
      for (const c of ['movie_vocab', 'article_vocab', 'idioms', 'grammar', 'general']) copy.run(c, movie.doc_id, movie.title)
      db.exec("DELETE FROM doc_targets WHERE category = 'movie'")
    }
  },
  // Revision: the simple Day 1 → Day 3 → Day 7 schedule replaces FSRS. Existing cards keep their next
  // review date and history; their place on the ladder is taken from how often they were reviewed.
  (db) => {
    db.exec(`
      ALTER TABLE flashcards ADD COLUMN srs_step INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE flashcards ADD COLUMN interval_days REAL NOT NULL DEFAULT 0;
      ALTER TABLE flashcards ADD COLUMN ease REAL NOT NULL DEFAULT 1;
      ALTER TABLE flashcards ADD COLUMN last_reviewed_at TEXT;
      ALTER TABLE flashcards ADD COLUMN last_rating INTEGER;
      UPDATE flashcards SET
        srs_step = MIN(reps, 2),
        interval_days = CASE WHEN reps = 0 THEN 0 WHEN reps = 1 THEN 2 WHEN reps = 2 THEN 4 ELSE 8 END,
        last_reviewed_at = (SELECT MAX(reviewed_at) FROM flashcard_reviews r WHERE r.flashcard_id = flashcards.id),
        last_rating = (SELECT rating FROM flashcard_reviews r WHERE r.flashcard_id = flashcards.id ORDER BY reviewed_at DESC, id DESC LIMIT 1);
    `)
  }
]

/** Applies pending migrations, tracked with PRAGMA user_version. */
export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      MIGRATIONS[v](db)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length
