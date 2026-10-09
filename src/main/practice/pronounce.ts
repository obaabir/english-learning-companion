import type { PronounceResult, PronouncedWord } from '@shared/types'

/** CMU dictionary (free, offline): word → ARPAbet phonemes. Loaded on first use. */
let dict: Record<string, string> | null = null
async function dictionary(): Promise<Record<string, string>> {
  if (!dict) dict = (await import('cmu-pronouncing-dictionary')).dictionary as Record<string, string>
  return dict
}

const IPA: Record<string, string> = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's',
  SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ'
}
const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'])

/** Rough Bangla spelling of the sounds (a hint, not exact). [independent vowel, vowel sign] */
const BN_VOWEL: Record<string, [string, string]> = {
  AA: ['আ', 'া'], AE: ['অ্যা', '্যা'], AH: ['আ', 'া'], AO: ['অ', ''], AW: ['আউ', 'াউ'], AY: ['আই', 'াই'], EH: ['এ', 'ে'], ER: ['আর', 'ার'],
  EY: ['এই', 'েই'], IH: ['ই', 'ি'], IY: ['ঈ', 'ী'], OW: ['ও', 'ো'], OY: ['অয়', 'য়'], UH: ['উ', 'ু'], UW: ['ঊ', 'ূ']
}
const BN_CONS: Record<string, string> = {
  B: 'ব', CH: 'চ', D: 'ড', DH: 'দ', F: 'ফ', G: 'গ', HH: 'হ', JH: 'জ', K: 'ক', L: 'ল', M: 'ম', N: 'ন', NG: 'ং', P: 'প', R: 'র', S: 'স',
  SH: 'শ', T: 'ট', TH: 'থ', V: 'ভ', W: 'ওয়', Y: 'ইয়', Z: 'জ', ZH: 'ঝ'
}

/** Sounds Bangla speakers often find hard, with a one-line tip in Bangla. */
export const SOUND_TRAPS: Record<string, { label: string; tip: string }> = {
  V: { label: 'v', tip: 'v: উপরের দাঁত নিচের ঠোঁটে হালকা ছুঁইয়ে গলায় কম্পন দিন — "ভ" নয়।' },
  W: { label: 'w', tip: 'w: ঠোঁট গোল করে শুরু করুন ("ওয়") — দাঁত ঠোঁটে লাগবে না, "ভ" নয়।' },
  F: { label: 'f', tip: 'f: উপরের দাঁত নিচের ঠোঁটে রেখে বাতাস ছাড়ুন — দুই ঠোঁট বন্ধ করা "ফ" নয়।' },
  Z: { label: 'z', tip: 'z: দাঁতের পেছনে মৌমাছির মতো "জ়্‌জ়্‌" শব্দ — বাংলা "জ" নয়।' },
  TH: { label: 'th (θ)', tip: 'th (θ, think): জিভের ডগা দুই দাঁতের মাঝে রেখে বাতাস — "থ" বা "ট" নয়।' },
  DH: { label: 'th (ð)', tip: 'th (ð, this): জিভ দাঁতের মাঝে রেখে গলায় কম্পন — "দ" নয়।' },
  IY: { label: 'long ee', tip: 'ee (sheep): লম্বা "ঈ" — ship-এর ছোট "ই"-র চেয়ে লম্বা টানুন।' },
  IH: { label: 'short i', tip: 'i (ship): ছোট, ঢিলা "ই" — sheep-এর মতো লম্বা নয়।' },
  UW: { label: 'long oo', tip: 'oo (pool): লম্বা "ঊ", ঠোঁট গোল — pull-এর ছোট "উ" নয়।' },
  UH: { label: 'short u', tip: 'u (pull): ছোট, ঢিলা "উ" — pool-এর মতো লম্বা নয়।' },
  AE: { label: 'æ', tip: 'æ (cat): মুখ বেশি খুলে "অ্যা" — "এ" নয়।' }
}

function toIpa(phones: string[]): string {
  const syllables = phones.filter((p) => VOWELS.has(p.replace(/\d/, ''))).length
  let out = ''
  phones.forEach((p, i) => {
    const base = p.replace(/\d/, '')
    const stress = p.match(/\d/)?.[0]
    if (VOWELS.has(base) && stress === '1' && syllables > 1) {
      // Put the stress mark before the consonant just before the stressed vowel (simple syllable split).
      const prev = phones[i - 1]?.replace(/\d/, '')
      if (prev && !VOWELS.has(prev) && out.endsWith(IPA[prev])) out = out.slice(0, -IPA[prev].length) + 'ˈ' + IPA[prev]
      else out += 'ˈ'
    }
    out += base === 'AH' && stress === '0' ? 'ə' : base === 'ER' && stress === '0' ? 'ɚ' : (IPA[base] ?? '')
  })
  return out
}

function toBangla(phones: string[]): string {
  let out = ''
  for (let i = 0; i < phones.length; i++) {
    const base = phones[i].replace(/\d/, '')
    const prev = phones[i - 1]?.replace(/\d/, '')
    if (VOWELS.has(base)) {
      const afterConsonant = prev && !VOWELS.has(prev) && BN_CONS[prev] && !BN_CONS[prev].startsWith('ও') && !BN_CONS[prev].startsWith('ই')
      out += afterConsonant ? BN_VOWEL[base][1] : BN_VOWEL[base][0]
    } else {
      const next = phones[i + 1]?.replace(/\d/, '')
      out += BN_CONS[base] ?? ''
      // Join consonant clusters (hasant), e.g. "street" → স্ট্রীট
      if (next && !VOWELS.has(next) && /[ক-হ]$/.test(out)) out += '্'
    }
  }
  return out
}

/** The stressed syllable as letters, for a one-line stress tip (words of 3+ syllables). */
function stressTip(word: string, phones: string[]): string | null {
  const vowels = phones.filter((p) => VOWELS.has(p.replace(/\d/, '')))
  if (vowels.length < 3) return null
  const n = vowels.findIndex((p) => p.endsWith('1')) + 1
  if (n <= 0) return null
  const ord = ['১ম', '২য়', '৩য়', '৪র্থ', '৫ম', '৬ষ্ঠ'][n - 1] ?? `${n}`
  return `${word}: জোর (stress) দিন ${ord} অংশে — ${vowels.length}টি অংশের মধ্যে।`
}

export async function pronounce(text: string): Promise<PronounceResult> {
  const d = await dictionary()
  const tokens = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []
  const words: PronouncedWord[] = []
  const trapsSeen = new Set<string>()
  const tips: { sound: string; tip: string }[] = []
  const stressTips: { sound: string; tip: string }[] = []
  for (const token of tokens) {
    const key = token.toLowerCase().replace('’', "'")
    const entry = d[key]
    if (!entry) {
      words.push({ word: token, ipa: null, bangla: null, traps: [] })
      continue
    }
    const phones = entry.split(' ')
    const traps = [...new Set(phones.map((p) => p.replace(/\d/, '')).filter((p) => SOUND_TRAPS[p]))]
    for (const t of traps) {
      if (!trapsSeen.has(t)) {
        trapsSeen.add(t)
        tips.push({ sound: SOUND_TRAPS[t].label, tip: SOUND_TRAPS[t].tip })
      }
    }
    const stress = stressTip(token, phones)
    if (stress) stressTips.push({ sound: 'stress', tip: stress })
    words.push({ word: token, ipa: toIpa(phones), bangla: toBangla(phones), traps: traps.map((t) => SOUND_TRAPS[t].label) })
  }
  // Up to 4 sound tips plus up to 2 word-stress tips, so long lines don't crowd out stress.
  return { words, tips: [...tips.slice(0, 4), ...stressTips.slice(0, 2)] }
}
