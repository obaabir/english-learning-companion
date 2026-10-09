import { create } from 'zustand'
import type { Chat, ChatMessage, StudyContext } from '@shared/types'
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

  loadChats: () => Promise<void>
  openChat: (id: number | null) => Promise<void>
  startChat: (args: {
    promptId: number | null
    context: StudyContext
    mediaPath?: string | null
    timestampSec?: number | null
    explanationMd?: string | null
  }) => Promise<void>
  send: (text: string) => Promise<void>
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

  loadChats: async () => set({ chats: await invoke('chats:list') }),

  openChat: async (id) => {
    set({ activeChatId: id, messages: id ? await invoke('chats:messages', id) : [], streaming: null })
  },

  startChat: async (args) => {
    const chat = await invoke('chats:create', args)
    await get().loadChats()
    await get().openChat(chat.id)
  },

  send: async (text) => {
    let chatId = get().activeChatId
    if (!chatId) {
      const chat = await invoke('chats:create', { promptId: null, context: { text: '' } })
      await get().loadChats()
      chatId = chat.id
      set({ activeChatId: chatId, messages: [] })
    }
    const optimistic: ChatMessage = { id: -Date.now(), chatId, role: 'user', content: text, createdAt: new Date().toISOString() }
    set({ messages: [...get().messages, optimistic], streaming: '', sending: true })
    const requestId = newRequestId()
    try {
      await streamCall(
        requestId,
        (delta) => set({ streaming: (get().streaming ?? '') + delta }),
        () => invoke('chats:send', { requestId, chatId: chatId!, text })
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
