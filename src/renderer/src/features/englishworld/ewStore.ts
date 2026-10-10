// English World: personal settings on this device only (key "ew-me"), plus a typed call helper.
import { create } from 'zustand'
import type { EwMethod, EwMethods } from '@shared/ew'
import { invoke } from '@renderer/lib/api'

/** Calls the English World service in the main process. */
export function ew<M extends EwMethod>(method: M, args: Parameters<EwMethods[M]>[0]): Promise<ReturnType<EwMethods[M]>> {
  return invoke('ew:call', { method, args } as never) as Promise<ReturnType<EwMethods[M]>>
}

export interface EwMe {
  ageGroup: 'under18' | '18plus' | null
  /** Photo posts: off by default for under-18 accounts. */
  photosOn: boolean
  following: string[]
  blocked: string[]
  /** "Your posts are visible to everyone" was shown. */
  noticeSeen: boolean
  /** Bell: last time notifications were opened. */
  seenAt: string | null
}

const KEY = 'ew-me'
const DEFAULT: EwMe = { ageGroup: null, photosOn: false, following: [], blocked: [], noticeSeen: false, seenAt: null }

function load(): EwMe {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT
  }
}

interface EwMeStore extends EwMe {
  update: (patch: Partial<EwMe>) => void
  toggleFollow: (id: string) => void
  block: (id: string) => void
  unblock: (id: string) => void
}

export const useEwMe = create<EwMeStore>((set, get) => {
  const update = (patch: Partial<EwMe>): void => {
    set(patch)
    try {
      const { ageGroup, photosOn, following, blocked, noticeSeen, seenAt } = get()
      localStorage.setItem(KEY, JSON.stringify({ ageGroup, photosOn, following, blocked, noticeSeen, seenAt }))
    } catch {
      // storage unavailable: kept for this session
    }
  }
  return {
    ...load(),
    update,
    toggleFollow: (id) => {
      const f = get().following
      update({ following: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] })
    },
    block: (id) => update({ blocked: [...new Set([...get().blocked, id])], following: get().following.filter((x) => x !== id) }),
    unblock: (id) => update({ blocked: get().blocked.filter((x) => x !== id) })
  }
})
