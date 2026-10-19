import { create } from 'zustand'
import type { Chat, ChatFocus, ChatMessage, StudyContext } from '@shared/types'
import { invoke, newRequestId, streamCall } from '@renderer/lib/api'

interface ChatState {
  chats: Chat[]
  activeChatId: number | null
  messages: ChatMessage[]
  streaming: string | null
  sending: boolean
  /** The unsent message, kept here so it survives the chat being folded or re-laid-out. */
  draft: string
  setDraft: (draft: string) => void
  /** The text highlighted in the explanation or a chat answer; the next question is about it. */
  focus: ChatFocus | null
  setFocus: (focus: ChatFocus | null) => void

  loadChats: () => Promise<void>
  openChat: (id: number | null) => Promise<void>
  startChat: (args: {
    promptId: number | null
    context: StudyContext
    mediaPath?: string | null
    timestampSec?: number | null
    explanationMd?: string | null
  }) => Promise<void>
  /** focus: false sends without the current highlight (self-contained questions). */
  send: (text: string, opts?: { focus?: boolean }) => Promise<void>
  deleteChat: (id: number) => Promise<void>
}

export const useChat = create<ChatState>((set, get) => ({
  chats: [],
  activeChatId: null,
  messages: [],
  streaming: null,
  sending: false,
  draft: '',
  setDraft: (draft) => set({ draft }),
  focus: null,
  setFocus: (focus) => set({ focus }),

  loadChats: async () => set({ chats: await invoke('chats:list') }),

  openChat: async (id) => {
    set({ activeChatId: id, messages: id ? await invoke('chats:messages', id) : [], streaming: null })
  },

  startChat: async (args) => {
    const chat = await invoke('chats:create', args)
    await get().loadChats()
    await get().openChat(chat.id)
  },

  send: async (text, opts) => {
    let chatId = get().activeChatId
    if (!chatId) {
      const chat = await invoke('chats:create', { promptId: null, context: { text: '' } })
      await get().loadChats()
      chatId = chat.id
      set({ activeChatId: chatId, messages: [] })
    }
    // The highlight belongs to this question only; the saved message keeps it for later turns.
    const focus = opts?.focus === false ? null : get().focus
    const optimistic: ChatMessage = { id: -Date.now(), chatId, role: 'user', content: text, createdAt: new Date().toISOString(), focus }
    set({ messages: [...get().messages, optimistic], streaming: '', sending: true, ...(focus ? { focus: null } : {}) })
    const requestId = newRequestId()
    try {
      await streamCall(
        requestId,
        (delta) => set({ streaming: (get().streaming ?? '') + delta }),
        () => invoke('chats:send', { requestId, chatId: chatId!, text, focus })
      )
    } finally {
      if (get().activeChatId === chatId) set({ messages: await invoke('chats:messages', chatId) })
      set({ streaming: null, sending: false })
    }
  },

  deleteChat: async (id) => {
    await invoke('chats:delete', id)
    if (get().activeChatId === id) set({ activeChatId: null, messages: [] })
    await get().loadChats()
  }
}))
