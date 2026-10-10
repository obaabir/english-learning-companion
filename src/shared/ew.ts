/** English World (community section): types shared by main and renderer. */

export type EwLevel = 'Beginner' | 'Intermediate' | 'IELTS'
export type EwKind = 'post' | 'question' | 'story' | 'win'
export type EwReaction = 'learned' | 'brave' | 'clear'
export type EwTarget = 'post' | 'comment' | 'fix' | 'profile'
export type EwReportReason = 'bullying' | 'inappropriate' | 'personal_info' | 'spam'

export interface EwAuthor {
  name: string
  avatar: string
  level: EwLevel
}

export interface EwProfile extends EwAuthor {
  id: string
  goal: string
}

export interface EwPost {
  id: string
  authorId: string
  author: EwAuthor
  kind: EwKind
  text: string
  hasImage: boolean
  bg: string | null
  tags: string[]
  correctMe: boolean
  challengeDay: string | null
  aiAnswer: { bn: string; en: string } | null
  solvedCommentId: string | null
  hidden: boolean
  createdAt: string
  expiresAt: string | null
}

export interface EwStats {
  postId: string
  learned: number
  brave: number
  clear: number
  fixes: number
  comments: number
  mine: EwReaction[]
}

export interface EwFix {
  id: string
  postId: string
  authorId: string
  author: EwAuthor
  text: string
  note: string
  helpful: boolean
  hidden: boolean
  createdAt: string
}

export interface EwComment {
  id: string
  postId: string
  parentId: string | null
  authorId: string
  author: EwAuthor
  text: string
  hidden: boolean
  createdAt: string
}

export interface EwNotification {
  kind: 'reaction' | 'correction' | 'helpful' | 'answer'
  postId: string
  actorName: string
  actorAvatar: string
  detail: string
  at: string
}

export interface EwModItem {
  targetType: EwTarget
  targetId: string
  postId: string | null
  text: string
  authorName: string
  hidden: boolean
  reports: number
  reasons: string[]
  createdAt: string
}

export interface EwCheckResult {
  ok: boolean
  corrected: string
  mistakes: { wrong: string; fix: string; why: string }[]
}

export interface EwStatus {
  configured: boolean
  url: string | null
  userId: string | null
  profile: EwProfile | null
  error: string | null
}

export type EwFeedTab = 'latest' | 'following' | 'challenge' | 'questions' | 'stories' | 'mine'

export interface EwPublishResult {
  ok: boolean
  id?: string
  error?: string
  flagged?: boolean
}

export type EwPublish =
  | { action: 'post'; kind: EwKind; text: string; image: string | null; bg: string | null; tags: string[]; correctMe: boolean; challengeDay: string | null }
  | { action: 'comment'; postId: string; parentId: string | null; text: string }
  | { action: 'fix'; postId: string; text: string; note: string }

/** Every English World call (main process). Results are wrapped in a Promise over IPC. */
export interface EwMethods {
  status: (a: null) => EwStatus
  configure: (a: { url: string; key: string }) => EwStatus
  disconnect: (a: null) => EwStatus
  saveProfile: (a: { name: string; avatar: string; level: EwLevel; goal: string }) => EwProfile
  feed: (a: { tab: EwFeedTab; page: number; authorIds?: string[]; day?: string }) => EwPost[]
  image: (a: { postId: string }) => string | null
  stats: (a: { ids: string[] }) => EwStats[]
  publish: (a: EwPublish) => EwPublishResult
  check: (a: { text: string }) => { ok: boolean; result?: EwCheckResult; error?: string }
  react: (a: { postId: string; type: EwReaction; on: boolean }) => true
  thread: (a: { postId: string }) => { fixes: EwFix[]; comments: EwComment[] }
  markHelpful: (a: { fixId: string }) => boolean
  markSolved: (a: { commentId: string }) => boolean
  report: (a: { targetType: EwTarget; targetId: string; reason: EwReportReason }) => true
  remove: (a: { target: 'post' | 'comment' | 'fix'; id: string }) => true
  notifications: (a: { since: string }) => EwNotification[]
  modStatus: (a: null) => boolean
  modSetup: (a: { passcode: string }) => boolean
  modQueue: (a: { passcode: string }) => EwModItem[]
  modSetHidden: (a: { passcode: string; targetType: EwTarget; targetId: string; hide: boolean }) => boolean
}

export type EwMethod = keyof EwMethods
export type EwRequest = { [M in EwMethod]: { method: M; args: Parameters<EwMethods[M]>[0] } }[EwMethod]
