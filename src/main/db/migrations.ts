import type { DatabaseSync } from 'node:sqlite'

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
