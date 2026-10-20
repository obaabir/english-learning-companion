/** Speaking Coach: saved transcripts, kept in IndexedDB on this computer (the app's SQLite lives in the main process). */
import type { TranscriptLine } from './transcriptFormat'

export interface SavedTranscript {
  id: string
  title: string
  fileName: string
  fileSize: number
  durationSec: number | null
  model: string
  /** False when some parts failed and the transcript is missing pieces. */
  complete: boolean
  createdAt: number
  updatedAt: number
  lines: TranscriptLine[]
}

export type TranscriptSummary = Omit<SavedTranscript, 'lines'> & { lineCount: number }

const DB_NAME = 'elc-speaking-coach'
const STORE = 'transcripts'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch((err) => {
    dbPromise = null
    throw err
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error ?? req.error)
    tx.onabort = () => reject(tx.error ?? new Error('Saving was cancelled'))
  })
}

export async function listTranscripts(): Promise<TranscriptSummary[]> {
  const all = await run<SavedTranscript[]>('readonly', (s) => s.getAll() as IDBRequest<SavedTranscript[]>)
  return all
    .map(({ lines, ...rest }) => ({ ...rest, lineCount: lines.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getTranscript(id: string): Promise<SavedTranscript | null> {
  return (await run<SavedTranscript | undefined>('readonly', (s) => s.get(id) as IDBRequest<SavedTranscript | undefined>)) ?? null
}

export async function saveTranscript(t: SavedTranscript): Promise<void> {
  await run('readwrite', (s) => s.put(t))
}

export async function deleteTranscript(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}
