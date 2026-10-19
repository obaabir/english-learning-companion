import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  draftsFromOcrLines,
  markDuplicates,
  parseWordList,
  sentenceWith,
  VB_SOURCE_KINDS,
  type VbDraft,
  type VbExtraction,
  type VbItem,
  type VbSourceKind
} from '@shared/vocabBook'
import type { GoogleDocInfo } from '@shared/types'
import type { Db } from '../db'
import { getSetting, setSetting } from '../db/repos/settings'
import { applyEnrichment, bookTerms, getBook, getItem, getSource, importItems, itemsNotInDoc, markEnrichError, markVbSyncError, markVbSynced, type ImportInput } from '../db/repos/vocabBook'
import type { DocEntry } from '../google/docs'
import type { VbEnrichResult, VbImageResult } from '../ai/gemini'

/** Offline OCR with the engine built into Windows (free, no internet). */
const OCR_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(30000); $t.Result }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:ELC_OCR_FILE)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $lang = New-Object Windows.Globalization.Language 'en-US'
  $engine = if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) } else { [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if ($null -eq $engine) { throw 'Windows has no OCR language installed (Settings > Time & language > Language: add English).' }
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  if ($bitmap.PixelWidth -gt $max -or $bitmap.PixelHeight -gt $max) { throw "The picture is too large for Windows OCR (max $max pixels per side)." }
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose()
  @{ ok = $true; lines = @($result.Lines | ForEach-Object { $_.Text }) } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`

export function windowsOcr(imagePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', OCR_SCRIPT], { env: { ...process.env, ELC_OCR_FILE: imagePath }, windowsHide: true })
    let out = ''
    let err = ''
    ps.stdout.on('data', (d) => (out += d.toString('utf8')))
    ps.stderr.on('data', (d) => (err += d.toString('utf8')))
    const timer = setTimeout(() => ps.kill(), 60_000)
    ps.on('error', (e) => (clearTimeout(timer), reject(e)))
    ps.on('close', () => {
      clearTimeout(timer)
      try {
        const r = JSON.parse(out.trim().split(/\r?\n/).pop() ?? '') as { ok: boolean; lines?: string[] | string; error?: string }
        if (!r.ok) return reject(new Error(r.error ?? 'Windows OCR failed.'))
        resolve(Array.isArray(r.lines) ? r.lines : r.lines ? [r.lines] : [])
      } catch {
        reject(new Error(`Windows OCR failed${err ? `: ${err.slice(0, 200)}` : '.'}`))
      }
    })
  })
}

export interface VbGemini {
  configured: boolean
  vocabFromImage(imageBase64: string, mimeType: string): Promise<VbImageResult>
  vocabFromText(text: string): Promise<{ items: { term: string; context: string }[] }>
  enrichVocab(items: { id: number; term: string; context: string }[]): Promise<VbEnrichResult[]>
}

export interface VbGoogle {
  connected: boolean
  appendEntry(docId: string, entry: DocEntry): Promise<void>
  docContains(docId: string, text: string): Promise<boolean>
  createDoc(title: string): Promise<GoogleDocInfo>
}

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/gif': 'gif' }
export const VB_DOC_SETTING = 'vocabBookDoc'
export const VB_DOC_DEFAULT_TITLE = 'Vocabulary Book Notes'
export const vbRecordId = (uid: string): string => `elc-vb-${uid}`

/** One word as an entry in the Vocabulary Book Google Doc. */
export function vbDocEntry(item: VbItem, bookTitle: string, source: { kind: VbSourceKind; title: string | null; pageRef: string | null } | null): DocEntry {
  const fields: DocEntry['fields'] = [{ label: 'Book', value: `${bookTitle} · word ${item.seq}` }]
  const add = (label: string, value: string | null | undefined): void => {
    if (value && value.trim()) fields.push({ label, value: value.trim() })
  }
  add('Part of speech', item.pos)
  add('Bangla meaning', item.meaningBn)
  add('Definition', item.definitionEn)
  add('Context', item.context)
  add('Example', item.example)
  add('Bangla translation', item.exampleBn)
  add('Synonyms', item.synonyms.join(', '))
  add('Collocations', item.collocations.join(', '))
  if (source) add('Source', [VB_SOURCE_KINDS.find((k) => k.value === source.kind)?.label, source.title, source.pageRef ?? item.pageRef].filter(Boolean).join(' · '))
  add('Added', item.createdAt.slice(0, 10))
  fields.push({ label: 'Record ID', value: vbRecordId(item.uid) })
  return { title: `${item.seq}. ${item.term}`, fields }
}

export function createVocabBook(db: Db, deps: { gemini: VbGemini; google: VbGoogle; imagesDir: string; ocr?: (path: string) => Promise<string[]>; autoSync?: () => boolean; onChange?: (bookId: number) => void }) {
  const ocr = deps.ocr ?? windowsOcr

  /** Reads the words in a picture. Gemini (vision) when a key is set; otherwise, or if that fails, Windows OCR. */
  async function extractImage(args: { bookId: number; imageBase64: string; mimeType: string }): Promise<VbExtraction> {
    const ext = IMAGE_TYPES[args.mimeType]
    if (!ext) throw new Error('Use a PNG, JPG, WEBP, BMP or GIF picture.')
    const bytes = Buffer.from(args.imageBase64, 'base64')
    if (bytes.length > 15 * 1024 * 1024) throw new Error('The picture is larger than 15 MB. Use a smaller photo.')
    mkdirSync(deps.imagesDir, { recursive: true })
    const imageFile = `${randomUUID()}.${ext}`
    writeFileSync(join(deps.imagesDir, imageFile), bytes)
    const existing = bookTerms(db, args.bookId)
    let geminiError: string | null = null
    if (deps.gemini.configured) {
      try {
        const r = await deps.gemini.vocabFromImage(args.imageBase64, args.mimeType)
        const drafts: VbDraft[] = (r?.items ?? [])
          .map((i) => ({ term: (i.term ?? '').trim(), meaningBn: i.meaning_bn?.trim() || undefined, context: i.context?.trim() || undefined, uncertain: !!i.uncertain, note: i.note?.trim() || undefined }))
          .filter((d) => d.term)
        const complete = !!r?.complete && drafts.length > 0
        return {
          drafts: markDuplicates(drafts, existing),
          engine: 'gemini',
          complete,
          warning: drafts.length === 0 ? 'No vocabulary could be read from this picture.' : complete ? null : r?.warning?.trim() || 'Part of the page may be missing or unreadable.',
          pageRef: r?.page_ref?.trim() || null,
          imageFile
        }
      } catch (err) {
        geminiError = err instanceof Error ? err.message : String(err)
      }
    }
    try {
      const lines = await ocr(join(deps.imagesDir, imageFile))
      const { drafts, pageRef } = draftsFromOcrLines(lines)
      const why = geminiError ? `Gemini could not read the picture (${geminiError.slice(0, 120)}), so Windows OCR (offline) was used. ` : 'Read with Windows OCR (offline). '
      return {
        drafts: markDuplicates(drafts, existing),
        engine: 'windows-ocr',
        // Offline OCR can't tell how sure it is: every word is marked "check".
        complete: false,
        warning: drafts.length ? `${why}Check every word against the picture before importing; meanings printed on the page are not separated reliably.` : `${why}No words were found.`,
        pageRef,
        imageFile,
        rawText: lines.join('\n')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { drafts: [], engine: 'windows-ocr', complete: false, warning: `The picture could not be read${geminiError ? ` (Gemini: ${geminiError.slice(0, 100)})` : ''}: ${msg}`, pageRef: null, imageFile }
    }
  }

  /** Words from a story / passage (Gemini chooses; without a key you type them) or from a pasted / typed list. */
  async function extractText(args: { bookId: number; kind: VbSourceKind; text: string }): Promise<VbExtraction> {
    const existing = bookTerms(db, args.bookId)
    const text = args.text.trim()
    if (!text) throw new Error('Paste or type some text first.')
    if (args.kind === 'story' || args.kind === 'passage') {
      if (!deps.gemini.configured)
        return {
          drafts: [],
          engine: 'text',
          complete: false,
          warning: 'Without a Gemini key the app cannot choose words from the text. Type the words you want to learn below — their sentences are taken from the text.',
          pageRef: null
        }
      const r = await deps.gemini.vocabFromText(text)
      const drafts = (r?.items ?? [])
        .map((i) => ({ term: (i.term ?? '').trim(), context: (i.context ?? '').trim() || sentenceWith(text, i.term ?? '') || undefined }))
        .filter((d) => d.term)
      return { drafts: markDuplicates(drafts, existing), engine: 'gemini', complete: drafts.length > 0, warning: drafts.length ? null : 'No vocabulary was chosen from this text.', pageRef: null }
    }
    const drafts = parseWordList(text)
    return { drafts: markDuplicates(drafts, existing), engine: 'text', complete: drafts.length > 0, warning: drafts.length ? null : 'No words found. Put one word or phrase per line.', pageRef: null }
  }

  // Meanings are filled in one batch at a time, in the background.
  const queue: number[] = []
  let running = false
  async function runQueue(): Promise<void> {
    if (running) return
    running = true
    try {
      while (queue.length) {
        const ids = queue.splice(0, 10)
        const items = ids.map((id) => getItem(db, id)).filter((i): i is VbItem => !!i)
        try {
          const res = await deps.gemini.enrichVocab(items.map((i) => ({ id: i.id, term: i.term, context: i.context })))
          for (const i of items) {
            const r = res?.find((x) => x.id === i.id)
            if (!r) {
              markEnrichError(db, i.id, 'Gemini did not return this word.')
              continue
            }
            applyEnrichment(db, i.id, {
              meaningBn: r.meaning_bn,
              definitionEn: r.definition_en,
              pos: r.pos,
              example: r.example,
              exampleBn: r.example_bn,
              synonyms: r.synonyms,
              collocations: r.collocations
            })
          }
        } catch (err) {
          for (const i of items) markEnrichError(db, i.id, err instanceof Error ? err.message : String(err))
        }
        if (items[0]) deps.onChange?.(items[0].bookId)
      }
    } finally {
      running = false
    }
  }

  function enrich(ids: number[]): void {
    if (!deps.gemini.configured || !ids.length) return
    queue.push(...ids)
    void runQueue().then(() => {
      if (deps.autoSync?.() && ids.length) {
        const bookId = getItem(db, ids[0])?.bookId
        if (bookId) void syncBook(bookId).catch(() => undefined)
      }
    })
  }

  /** Imports reviewed words in order; meanings are then filled in (keeping any you typed). */
  function importReviewed(input: ImportInput): ReturnType<typeof importItems> {
    const story = input.kind === 'story' || input.kind === 'passage'
    const drafts = story && input.text ? input.drafts.map((d) => ({ ...d, context: d.context || sentenceWith(input.text!, d.term) || undefined })) : input.drafts
    const r = importItems(db, { ...input, drafts })
    enrich(r.added.map((i) => i.id))
    return r
  }

  // ---- Google Docs: one separate destination for this module.
  const getDoc = (): GoogleDocInfo | null => {
    try {
      return JSON.parse(getSetting(db, VB_DOC_SETTING) ?? 'null') as GoogleDocInfo | null
    } catch {
      return null
    }
  }
  const setDoc = (doc: GoogleDocInfo): GoogleDocInfo => {
    setSetting(db, VB_DOC_SETTING, JSON.stringify({ id: doc.id, title: doc.title }))
    return doc
  }

  /** Appends this book's words that are not yet in the Vocabulary Book doc, in order. Stops at the first failure. */
  async function syncBook(bookId: number): Promise<{ added: number; error: string | null }> {
    const doc = getDoc()
    if (!doc) return { added: 0, error: `Choose a Google Doc for Vocabulary Book Learning first (for example "${VB_DOC_DEFAULT_TITLE}").` }
    if (!deps.google.connected) return { added: 0, error: 'Connect Google in Settings first.' }
    const book = getBook(db, bookId)
    if (!book) throw new Error('Book not found.')
    let added = 0
    for (const id of itemsNotInDoc(db, bookId, doc.id)) {
      const item = getItem(db, id)
      if (!item) continue
      try {
        // An earlier append whose answer was lost: check the doc first, so nothing is written twice.
        if (item.gdocError?.startsWith('uncertain:') && (await deps.google.docContains(doc.id, vbRecordId(item.uid)))) {
          markVbSynced(db, id, doc.id)
          continue
        }
        const src = item.sourceId ? getSource(db, item.sourceId) : null
        await deps.google.appendEntry(doc.id, vbDocEntry(item, book.title, src))
        markVbSynced(db, id, doc.id)
        added++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        markVbSyncError(db, id, (err as { uncertain?: boolean }).uncertain ? `uncertain: ${msg}` : msg)
        return { added, error: msg }
      }
    }
    return { added, error: null }
  }

  function sourceImage(file: string): string {
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp|bmp|gif)$/.test(file)) throw new Error('Unknown picture.')
    const ext = file.split('.').pop()!
    const mime = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)?.[0] ?? 'image/png'
    return `data:${mime};base64,${readFileSync(join(deps.imagesDir, file)).toString('base64')}`
  }

  return { extractImage, extractText, importReviewed, enrich, getDoc, setDoc, syncBook, sourceImage }
}

/** For tests: OCR a picture given as base64 (writes a temporary file). */
export async function ocrBase64(imageBase64: string, ext = 'png'): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'elc-ocr-'))
  try {
    const file = join(dir, `page.${ext}`)
    writeFileSync(file, Buffer.from(imageBase64, 'base64'))
    return await windowsOcr(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
