// English World: feed (For You · Following · Challenge · Questions), stories, post cards and threads.
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Flag, Loader2, MessageCircle, MoreHorizontal, PenLine, Reply, Sparkles, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import type { EwComment, EwFeedTab, EwFix, EwPost, EwReaction, EwReportReason, EwStats, EwTarget } from '@shared/ew'
import { errorMessage } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { FEED_LIMIT, KIND_LABEL, REACTIONS, REPORT_REASONS, challengeFor, localDay, personalInfo, rankForYou, timeAgo, wordDiff } from './ewLogic'
import { Dialog, type ComposerPreset } from './EwComposer'
import { ew, useEwMe } from './ewStore'

export type FeedView = 'foryou' | 'following' | 'challenge' | 'questions'

/* ------------------------------ Small pieces ------------------------------ */

export function Avatar({ emoji, size = 36 }: { emoji: string; size?: number }): ReactNode {
  return (
    <span className="ew-avatar" style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>
      {emoji}
    </span>
  )
}

export function Skeleton(): ReactNode {
  return (
    <div className="ew-card space-y-3 p-4" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="ew-skel size-9 rounded-full" />
        <div className="ew-skel h-3 w-32" />
      </div>
      <div className="ew-skel h-3 w-full" />
      <div className="ew-skel h-3 w-3/4" />
    </div>
  )
}

function ReportDialog({ target, onClose }: { target: { type: EwTarget; id: string; label: string }; onClose: () => void }): ReactNode {
  const [sent, setSent] = useState(false)
  const send = async (reason: EwReportReason): Promise<void> => {
    try {
      await ew('report', { targetType: target.type, targetId: target.id, reason })
      setSent(true)
    } catch (err) {
      useApp.getState().toastError(err)
    }
  }
  return (
    <Dialog title={`Report this ${target.label}`} onClose={onClose}>
      {sent ? (
        <>
          <p className="text-sm">Thank you. A moderator will look at it. If 3 people report it, it is hidden for everyone until it is reviewed.</p>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={onClose}>
              OK
            </Button>
          </div>
        </>
      ) : (
        <div className="grid gap-2">
          {REPORT_REASONS.map((r) => (
            <Button key={r.reason} className="ew-tap justify-start" icon={<Flag className="size-4" />} onClick={() => void send(r.reason)}>
              {r.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </Dialog>
  )
}

function Diff({ before, after }: { before: string; after: string }): ReactNode {
  return (
    <p className="text-[15px] leading-relaxed">
      {wordDiff(before, after).map((p, i) => (
        <span key={i}>
          <span className={p.op === 'del' ? 'ew-del' : p.op === 'add' ? 'ew-add' : undefined}>{p.text}</span>{' '}
        </span>
      ))}
    </p>
  )
}

/* ------------------------------ Stories ------------------------------ */

export function StoriesRow({ refreshKey, onNew, myId }: { refreshKey: number; onNew: () => void; myId: string | null }): ReactNode {
  const blocked = useEwMe((s) => s.blocked)
  const [stories, setStories] = useState<EwPost[] | null>(null)
  const [open, setOpen] = useState<EwPost | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    ew('feed', { tab: 'stories', page: 0 })
      .then((s) => live && setStories(s))
      .catch(() => live && setStories([]))
    return () => {
      live = false
    }
  }, [refreshKey])

  // Photo stories: load the pictures for the row (max 30 stories).
  useEffect(() => {
    for (const s of stories ?? []) if (s.hasImage && !images[s.id]) void ew('image', { postId: s.id }).then((img) => img && setImages((m) => ({ ...m, [s.id]: img })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories])

  const list = (stories ?? []).filter((s) => !blocked.includes(s.authorId))
  return (
    <>
      <div className="ew-stories" aria-label="Stories">
        <button onClick={onNew} className="ew-story motion-press flex flex-col items-center justify-center gap-2 border-2 border-dashed border-rose/50 bg-white/70" style={{ color: 'var(--accent)' }} aria-label="Add a story">
          <span className="text-2xl">＋</span>
          <span className="text-xs font-semibold">My English day</span>
        </button>
        {stories === null
          ? [0, 1, 2].map((i) => <div key={i} className="ew-story ew-skel" />)
          : list.map((s) => (
              <button key={s.id} onClick={() => setOpen(s)} className="ew-story motion-press" style={{ background: s.bg ?? '#781b36' }} aria-label={`Story by ${s.author.name}`}>
                {images[s.id] && <img src={images[s.id]} alt="" className="absolute inset-0 size-full object-cover" />}
                <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[11px]">
                  {s.author.avatar} {s.author.name}
                </span>
                <span className="ew-story-text">{s.text}</span>
              </button>
            ))}
      </div>
      {open && (
        <div className="ew-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(null)}>
          <div className="relative w-full max-w-sm overflow-hidden rounded-2xl text-white" style={{ background: open.bg ?? '#781b36', minHeight: 360 }} onClick={(e) => e.stopPropagation()}>
            {images[open.id] && <img src={images[open.id]} alt="" className="absolute inset-0 size-full object-cover" />}
            <div className="relative flex min-h-[360px] flex-col justify-between bg-gradient-to-b from-black/30 via-transparent to-black/50 p-5">
              <div className="flex items-center gap-2 text-sm">
                <span>{open.author.avatar}</span>
                <b>{open.author.name}</b>
                <span className="opacity-80">· {timeAgo(open.createdAt)}</span>
                <button className="ew-tap ml-auto" onClick={() => setOpen(null)} aria-label="Close">
                  <X className="mx-auto size-5" />
                </button>
              </div>
              <p className="text-xl leading-snug font-semibold">{open.text}</p>
              {open.authorId === myId && (
                <Button
                  size="sm"
                  className="self-start"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() =>
                    void ew('remove', { target: 'post', id: open.id }).then(() => {
                      setStories((l) => (l ?? []).filter((x) => x.id !== open.id))
                      setOpen(null)
                    })
                  }
                >
                  Delete my story
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ------------------------------ Feed ------------------------------ */

const TAB_FOR: Record<FeedView, EwFeedTab> = { foryou: 'latest', following: 'following', challenge: 'challenge', questions: 'questions' }

export function Feed({
  view,
  myId,
  myLevel,
  refreshKey,
  onCompose
}: {
  view: FeedView
  myId: string | null
  myLevel: EwPost['author']['level'] | null
  refreshKey: number
  onCompose: (p: ComposerPreset) => void
}): ReactNode {
  const following = useEwMe((s) => s.following)
  const blocked = useEwMe((s) => s.blocked)
  const [posts, setPosts] = useState<EwPost[] | null>(null)
  const [stats, setStats] = useState<Map<string, EwStats>>(new Map())
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = localDay()

  const loadPage = useCallback(
    async (n: number) => {
      setLoading(true)
      setError(null)
      try {
        const batch = await ew('feed', { tab: TAB_FOR[view], page: n, authorIds: following, day: today })
        const st = await ew('stats', { ids: batch.map((p) => p.id) })
        const map = new Map(st.map((s) => [s.postId, s]))
        // Each page is ranked on its own and added below, so what you are reading never jumps.
        const ranked = view === 'foryou' ? rankForYou(batch, map, { level: myLevel, following, me: myId, now: Date.now() }) : batch
        setStats((m) => new Map([...m, ...map]))
        setPosts((p) => (n === 0 ? ranked : [...(p ?? []), ...ranked.filter((x) => !(p ?? []).some((y) => y.id === x.id))]))
        setMore(batch.length === 15)
        setPage(n)
      } catch (err) {
        setError(errorMessage(err))
        if (n === 0) setPosts([])
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, following.join(','), myId, myLevel, today]
  )

  useEffect(() => {
    setPosts(null)
    void loadPage(0)
  }, [loadPage, refreshKey])

  const visible = (posts ?? []).filter((p) => !blocked.includes(p.authorId))
  const caughtUp = visible.length >= FEED_LIMIT || (!more && posts !== null)

  const patchStats = (id: string, fn: (s: EwStats) => EwStats): void =>
    setStats((m) => {
      const cur = m.get(id) ?? { postId: id, learned: 0, brave: 0, clear: 0, fixes: 0, comments: 0, mine: [] }
      return new Map(m).set(id, fn(cur))
    })

  return (
    <div className="flex flex-col gap-3">
      {view === 'challenge' && (
        <div className="ew-card ew-fade p-4">
          <p className="text-xs font-semibold text-accent uppercase">🎯 Today’s challenge</p>
          <p className="mt-1 text-lg font-semibold">{challengeFor(today)}</p>
          <Button variant="primary" className="ew-tap mt-3" icon={<PenLine className="size-4" />} onClick={() => onCompose({ kind: 'post', challengeDay: today, challengePrompt: challengeFor(today) })}>
            Write my answer
          </Button>
        </div>
      )}
      {view === 'following' && !following.length && <p className="ew-card p-4 text-sm text-muted">Follow people from their posts (••• menu → Follow) to see them here.</p>}

      {posts === null ? (
        [0, 1, 2].map((i) => <Skeleton key={i} />)
      ) : (
        <>
          {visible.slice(0, FEED_LIMIT).map((p) => (
            <PostCard
              key={p.id}
              post={p}
              stats={stats.get(p.id)}
              myId={myId}
              onStats={(fn) => patchStats(p.id, fn)}
              onRemoved={() => setPosts((l) => (l ?? []).filter((x) => x.id !== p.id))}
            />
          ))}
          {error && (
            <div className="ew-card p-4 text-sm">
              <p>{error}</p>
              <Button size="sm" className="mt-2" onClick={() => void loadPage(page)}>
                Try again
              </Button>
            </div>
          )}
          {!visible.length && !error && <p className="ew-card p-6 text-center text-sm text-muted">{view === 'challenge' ? 'No answers yet. Be the first! 🌱' : 'Nothing here yet.'}</p>}
          {caughtUp && visible.length > 0 ? (
            <div className="ew-card ew-fade p-5 text-center">
              <p className="text-base font-semibold">You’re all caught up ✓</p>
              <p className="mt-1 text-sm text-muted">5 minutes of Practice?</p>
              <Button variant="primary" className="ew-tap mt-3" onClick={() => useApp.getState().setPage('room')}>
                Go to Practice Room
              </Button>
            </div>
          ) : (
            more &&
            visible.length > 0 && (
              <Button className="ew-tap self-center" icon={loading ? <Loader2 className="size-4 animate-spin" /> : undefined} onClick={() => void loadPage(page + 1)} disabled={loading}>
                Show more
              </Button>
            )
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------ Post card ------------------------------ */

const PostCard = memo(function PostCard({
  post,
  stats,
  myId,
  onStats,
  onRemoved
}: {
  post: EwPost
  stats: EwStats | undefined
  myId: string | null
  onStats: (fn: (s: EwStats) => EwStats) => void
  onRemoved: () => void
}): ReactNode {
  const me = useEwMe()
  const mine = post.authorId === myId
  const [menu, setMenu] = useState(false)
  const [report, setReport] = useState<{ type: EwTarget; id: string; label: string } | null>(null)
  const [thread, setThread] = useState<false | 'fix' | 'comments'>(false)
  const [image, setImage] = useState<string | null>(null)
  const imgRef = useRef<HTMLDivElement>(null)

  // Photos load only when the post comes on screen.
  useEffect(() => {
    if (!post.hasImage || image) return
    const el = imgRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        void ew('image', { postId: post.id }).then(setImage).catch(() => undefined)
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [post.hasImage, post.id, image])

  const react = async (type: EwReaction): Promise<void> => {
    const on = !(stats?.mine ?? []).includes(type)
    onStats((s) => ({ ...s, [type]: Math.max(0, s[type] + (on ? 1 : -1)), mine: on ? [...s.mine, type] : s.mine.filter((x) => x !== type) }))
    try {
      await ew('react', { postId: post.id, type, on })
    } catch (err) {
      onStats((s) => ({ ...s, [type]: Math.max(0, s[type] + (on ? -1 : 1)), mine: on ? s.mine.filter((x) => x !== type) : [...s.mine, type] }))
      useApp.getState().toastError(err)
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await ew('remove', { target: 'post', id: post.id })
      onRemoved()
    } catch (err) {
      useApp.getState().toastError(err)
    }
  }

  return (
    <article className="ew-card ew-fade p-4" aria-label={`${KIND_LABEL[post.kind]} by ${post.author.name}`}>
      <header className="flex items-center gap-3">
        <Avatar emoji={post.author.avatar} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{post.author.name}</p>
          <p className="text-[11px] text-muted">
            {post.author.level} · {timeAgo(post.createdAt)}
          </p>
        </div>
        {post.kind !== 'post' && <Badge tone={post.kind === 'win' ? 'warn' : 'accent'}>{post.kind === 'win' ? '🏆 Win' : post.kind === 'question' ? '❓ Question' : KIND_LABEL[post.kind]}</Badge>}
        <div className="relative">
          <Button variant="ghost" size="sm" className="ew-tap" icon={<MoreHorizontal className="size-5" />} onClick={() => setMenu(!menu)} aria-label="More" aria-expanded={menu} />
          {menu && (
            <div className="ew-menu" onMouseLeave={() => setMenu(false)}>
              {!mine && (
                <button onClick={() => (me.toggleFollow(post.authorId), setMenu(false))}>
                  {me.following.includes(post.authorId) ? <UserMinus className="size-4" /> : <UserPlus className="size-4" />}
                  {me.following.includes(post.authorId) ? 'Unfollow' : 'Follow'} {post.author.name}
                </button>
              )}
              {!mine && (
                <button onClick={() => (setReport({ type: 'post', id: post.id, label: 'post' }), setMenu(false))}>
                  <Flag className="size-4" /> Report post
                </button>
              )}
              {!mine && (
                <button onClick={() => (setReport({ type: 'profile', id: post.authorId, label: 'profile' }), setMenu(false))}>
                  <Flag className="size-4" /> Report profile
                </button>
              )}
              {!mine && (
                <button onClick={() => (me.block(post.authorId), setMenu(false))}>
                  <UserMinus className="size-4" /> Block {post.author.name}
                </button>
              )}
              {mine && (
                <button onClick={() => void remove()} className="text-danger">
                  <Trash2 className="size-4" /> Delete my post
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {post.hidden && mine && <p className="mt-2 rounded-lg bg-warn-soft px-2 py-1 text-xs text-warn">Hidden by moderators. Only you can see it.</p>}
      <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">{post.text}</p>
      {post.hasImage && (
        <div ref={imgRef} className="mt-3 overflow-hidden rounded-xl bg-[rgba(120,27,54,0.05)]" style={{ minHeight: image ? undefined : 180 }}>
          {image ? <img src={image} alt={`Photo by ${post.author.name}`} className="w-full" loading="lazy" /> : <div className="ew-skel h-[180px] w-full rounded-none" />}
        </div>
      )}
      {(post.tags.length > 0 || post.correctMe) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {post.correctMe && <Badge tone="accent">Correct me 🙏</Badge>}
          {post.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      )}

      {post.kind === 'question' && post.aiAnswer && (
        <div className="mt-3 rounded-xl bg-[rgba(31,95,139,0.07)] p-3 text-sm">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-info">
            <Sparkles className="size-3.5" /> AI answer
          </p>
          <p>{post.aiAnswer.bn}</p>
          <p className="mt-1 text-muted">{post.aiAnswer.en}</p>
        </div>
      )}
      {post.kind === 'question' && post.solvedCommentId && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#1f7a3a]">
          <CheckCircle2 className="size-4" /> Solved
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {REACTIONS.map((r) => (
          <button
            key={r.type}
            aria-pressed={(stats?.mine ?? []).includes(r.type)}
            onClick={() => void react(r.type)}
            title={r.label}
            className="ew-react ew-tap motion-press flex items-center gap-1 rounded-full border border-line/80 bg-white/70 px-3 text-sm"
          >
            <span aria-hidden>{r.emoji}</span>
            <span className="hidden text-xs sm:inline">{r.label}</span>
            <span className="text-xs tabular-nums">{stats?.[r.type] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line/60 pt-2">
        {!mine && post.kind !== 'question' && (
          <Button size="sm" className="ew-tap" icon={<PenLine className="size-4" />} onClick={() => setThread(thread === 'fix' ? false : 'fix')}>
            Correct
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ew-tap" icon={<MessageCircle className="size-4" />} onClick={() => setThread(thread ? false : 'comments')}>
          {post.kind === 'question' ? 'Answers' : 'Comments'} ({stats?.comments ?? 0}){post.kind !== 'question' ? ` · Corrections (${stats?.fixes ?? 0})` : ''}
        </Button>
      </div>

      {thread && <Thread post={post} myId={myId} startWithFix={thread === 'fix'} onCounts={(fixes, comments) => onStats((s) => ({ ...s, fixes, comments }))} />}
      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
    </article>
  )
})

/* ------------------------------ Thread ------------------------------ */

function Thread({ post, myId, startWithFix, onCounts }: { post: EwPost; myId: string | null; startWithFix: boolean; onCounts: (fixes: number, comments: number) => void }): ReactNode {
  const blocked = useEwMe((s) => s.blocked)
  const [data, setData] = useState<{ fixes: EwFix[]; comments: EwComment[] } | null>(null)
  const [solved, setSolved] = useState(post.solvedCommentId)
  const [report, setReport] = useState<{ type: EwTarget; id: string; label: string } | null>(null)
  const mine = post.authorId === myId

  const load = useCallback(async () => {
    try {
      const d = await ew('thread', { postId: post.id })
      setData(d)
      onCounts(d.fixes.filter((f) => !f.hidden).length, d.comments.filter((c) => !c.hidden).length)
    } catch (err) {
      useApp.getState().toastError(err)
      setData({ fixes: [], comments: [] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id])

  useEffect(() => {
    void load()
  }, [load])

  const removeItem = async (target: 'comment' | 'fix', id: string): Promise<void> => {
    try {
      await ew('remove', { target, id })
      await load()
    } catch (err) {
      useApp.getState().toastError(err)
    }
  }

  if (!data)
    return (
      <div className="mt-3 space-y-2">
        <div className="ew-skel h-10" />
        <div className="ew-skel h-10" />
      </div>
    )
  const fixes = data.fixes.filter((f) => !blocked.includes(f.authorId))
  const comments = data.comments.filter((c) => !blocked.includes(c.authorId))
  const top = comments.filter((c) => !c.parentId)

  return (
    <div className="ew-fade mt-3 space-y-4 border-t border-line/60 pt-3">
      {post.kind !== 'question' && (
        <section aria-label="Corrections" className="space-y-2">
          <p className="text-xs font-semibold text-muted uppercase">Corrections</p>
          {fixes.map((f) => (
            <div key={f.id} className="rounded-xl bg-white/70 p-3 ring-1 ring-line/60">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                <Avatar emoji={f.author.avatar} size={22} />
                <span className="font-medium text-fg">{f.author.name}</span>
                <span>· {timeAgo(f.createdAt)}</span>
                {f.helpful && <Badge tone="accent">Helpful ✓</Badge>}
              </div>
              <Diff before={post.text} after={f.text} />
              {f.note && <p className="mt-1 text-sm text-muted">💬 {f.note}</p>}
              <div className="mt-2 flex gap-1.5">
                {mine && !f.helpful && f.authorId !== myId && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      void ew('markHelpful', { fixId: f.id })
                        .then(load)
                        .catch((e) => useApp.getState().toastError(e))
                    }
                  >
                    Helpful ✓
                  </Button>
                )}
                {f.authorId === myId ? (
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void removeItem('fix', f.id)}>
                    Delete
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={<Flag className="size-3.5" />} onClick={() => setReport({ type: 'fix', id: f.id, label: 'correction' })}>
                    Report
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!fixes.length && <p className="text-sm text-muted">No corrections yet.</p>}
          {!mine && <FixForm post={post} startOpen={startWithFix} onSent={load} />}
        </section>
      )}

      <section aria-label={post.kind === 'question' ? 'Answers' : 'Comments'} className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase">{post.kind === 'question' ? 'Answers' : 'Comments'}</p>
        {top.map((c) => (
          <div key={c.id} className="space-y-2">
            <CommentRow
              c={c}
              myId={myId}
              solved={solved === c.id}
              canSolve={mine && post.kind === 'question' && !solved && c.authorId !== myId}
              onSolve={() =>
                void ew('markSolved', { commentId: c.id })
                  .then((ok) => ok && setSolved(c.id))
                  .catch((e) => useApp.getState().toastError(e))
              }
              onDelete={() => void removeItem('comment', c.id)}
              onReport={() => setReport({ type: 'comment', id: c.id, label: 'comment' })}
            />
            <div className="ml-8 space-y-2 border-l-2 border-line/60 pl-3">
              {comments
                .filter((r) => r.parentId === c.id)
                .map((r) => (
                  <CommentRow key={r.id} c={r} myId={myId} solved={false} canSolve={false} onSolve={() => undefined} onDelete={() => void removeItem('comment', r.id)} onReport={() => setReport({ type: 'comment', id: r.id, label: 'comment' })} />
                ))}
              <CommentForm postId={post.id} parentId={c.id} compact onSent={load} />
            </div>
          </div>
        ))}
        {!top.length && <p className="text-sm text-muted">{post.kind === 'question' ? 'No answers yet. Help them out!' : 'No comments yet.'}</p>}
        <CommentForm postId={post.id} parentId={null} onSent={load} placeholder={post.kind === 'question' ? 'Write an answer…' : 'Write a kind comment…'} />
      </section>
      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
    </div>
  )
}

function CommentRow({ c, myId, solved, canSolve, onSolve, onDelete, onReport }: { c: EwComment; myId: string | null; solved: boolean; canSolve: boolean; onSolve: () => void; onDelete: () => void; onReport: () => void }): ReactNode {
  return (
    <div className={cn('rounded-xl bg-white/70 p-3 ring-1 ring-line/60', solved && 'ring-2 ring-[#1f7a3a]/50')}>
      <div className="mb-1 flex items-center gap-2 text-xs text-muted">
        <Avatar emoji={c.author.avatar} size={22} />
        <span className="font-medium text-fg">{c.author.name}</span>
        <span>· {timeAgo(c.createdAt)}</span>
        {solved && <Badge tone="accent">Solved ✓</Badge>}
      </div>
      <p className="text-sm whitespace-pre-wrap">{c.text}</p>
      <div className="mt-1 flex gap-1">
        {canSolve && (
          <Button size="sm" variant="primary" onClick={onSolve}>
            Solved ✓
          </Button>
        )}
        {c.authorId === myId ? (
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
            Delete
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<Flag className="size-3.5" />} onClick={onReport}>
            Report
          </Button>
        )}
      </div>
    </div>
  )
}

function FixForm({ post, startOpen, onSent }: { post: EwPost; startOpen: boolean; onSent: () => void }): ReactNode {
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState(post.text)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const personal = personalInfo(`${text} ${note}`)
  if (!open)
    return (
      <Button size="sm" icon={<PenLine className="size-4" />} onClick={() => setOpen(true)}>
        Suggest a correction
      </Button>
    )
  const send = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await ew('publish', { action: 'fix', postId: post.id, text: text.trim(), note: note.trim() })
      if (r.ok) {
        setOpen(false)
        setNote('')
        onSent()
      } else setError(r.error ?? 'Not sent. Please try again.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const changed = text.trim() !== post.text.trim()
  return (
    <div className="ew-fade space-y-2 rounded-xl bg-accent-soft/60 p-3">
      <p className="text-xs font-semibold text-accent">Correct the English, never the person.</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Corrected version" />
      {changed && <Diff before={post.text} after={text} />}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder="A short, kind note (e.g. “went” is the past of “go” 🙂)"
        className="glass-field h-10 w-full rounded-[10px] border px-3 text-sm"
        aria-label="Kind note"
      />
      {(personal || error) && <p className="text-xs text-warn">{personal ?? error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : undefined} onClick={() => void send()} disabled={busy || !changed || !!personal || !text.trim()}>
          {busy ? 'Checking…' : 'Send correction'}
        </Button>
      </div>
    </div>
  )
}

function CommentForm({ postId, parentId, compact, placeholder, onSent }: { postId: string; parentId: string | null; compact?: boolean; placeholder?: string; onSent: () => void }): ReactNode {
  const [open, setOpen] = useState(!compact)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const personal = personalInfo(text)
  if (!open)
    return (
      <button className="flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={() => setOpen(true)}>
        <Reply className="size-3.5" /> Reply
      </button>
    )
  const send = async (): Promise<void> => {
    if (!text.trim() || personal) return
    setBusy(true)
    setError(null)
    try {
      const r = await ew('publish', { action: 'comment', postId, parentId, text: text.trim() })
      if (r.ok) {
        setText('')
        if (compact) setOpen(false)
        onSent()
      } else setError(r.error ?? 'Not sent. Please try again.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          maxLength={500}
          placeholder={placeholder ?? 'Write a reply…'}
          className="glass-field h-10 min-w-0 flex-1 rounded-full border px-4 text-sm"
          aria-label={placeholder ?? 'Reply'}
        />
        <Button size="sm" variant="primary" className="h-10 rounded-full px-4" onClick={() => void send()} disabled={busy || !text.trim() || !!personal}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : 'Send'}
        </Button>
      </div>
      {(personal || error) && <p className="text-xs text-warn">{personal ?? error}</p>}
    </div>
  )
}
