import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ocrLinesToParagraphs, UNCLEAR, type PageReadResult } from '@shared/reading'
import { windowsOcr } from '../vocabBook/service'

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/gif': 'gif' }

export interface BookPageRaw {
  page_number?: string
  paragraphs?: string[]
  note?: string
}

export interface ReadingGemini {
  configured: boolean
  readBookPage(imageBase64: string, mimeType: string): Promise<BookPageRaw | null>
}

const countUnclear = (paras: string[]): number => paras.reduce((n, p) => n + (p.split(UNCLEAR).length - 1), 0)

/**
 * Reading Companion: reads one photographed book page into paragraphs. Gemini (vision) first, which
 * keeps paragraphs and marks unreadable words [unclear]; if there is no key or it fails (free limit,
 * no internet), Windows OCR (offline), whose paragraph breaks are only estimated. The photo is kept so
 * the text can be checked against it.
 */
export function createReading(deps: { gemini: ReadingGemini; imagesDir: string; ocr?: (path: string) => Promise<string[]> }) {
  const ocr = deps.ocr ?? windowsOcr

  async function readPage(args: { imageBase64: string; mimeType: string }): Promise<PageReadResult> {
    const ext = IMAGE_TYPES[args.mimeType]
    if (!ext) throw new Error('Use a PNG, JPG, WEBP, BMP or GIF photo.')
    const bytes = Buffer.from(args.imageBase64, 'base64')
    if (bytes.length > 15 * 1024 * 1024) throw new Error('The photo is larger than 15 MB. Use a smaller photo.')
    mkdirSync(deps.imagesDir, { recursive: true })
    const imageFile = `${randomUUID()}.${ext}`
    writeFileSync(join(deps.imagesDir, imageFile), bytes)
    let geminiError: string | null = null
    if (deps.gemini.configured) {
      try {
        const r = await deps.gemini.readBookPage(args.imageBase64, args.mimeType)
        const paragraphs = (r?.paragraphs ?? []).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
        if (paragraphs.length) {
          const unclear = countUnclear(paragraphs)
          return {
            imageFile,
            label: r?.page_number?.trim() || null,
            paragraphs,
            engine: 'gemini',
            unclear,
            warning: unclear ? `${unclear} word${unclear === 1 ? '' : 's'} could not be read and ${unclear === 1 ? 'is' : 'are'} marked ${UNCLEAR}. Check them against the page.` : r?.note?.trim() || null
          }
        }
        geminiError = 'no text was found'
      } catch (err) {
        geminiError = err instanceof Error ? err.message : String(err)
      }
    }
    const lines = await ocr(join(deps.imagesDir, imageFile))
    const paragraphs = ocrLinesToParagraphs(lines)
    const why = geminiError ? `Gemini could not read the photo (${geminiError.slice(0, 120)}), so Windows OCR (offline) was used. ` : 'Read with Windows OCR (offline). '
    return {
      imageFile,
      label: null,
      paragraphs,
      engine: 'windows-ocr',
      unclear: 0,
      warning: paragraphs.length
        ? `${why}It cannot mark unclear words, and paragraph breaks are estimated: check the text against the page.`
        : `${why}No text was found in this photo.`
    }
  }

  /** A saved page photo as a data URL (for the preview next to its text). */
  function pageImage(file: string): string {
    if (!/^[\w-]+\.(png|jpg|webp|bmp|gif)$/.test(file)) throw new Error('Unknown photo.')
    const ext = file.split('.').pop()!
    const mime = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)?.[0] ?? 'image/png'
    return `data:${mime};base64,${readFileSync(join(deps.imagesDir, file)).toString('base64')}`
  }

  return { readPage, pageImage }
}
