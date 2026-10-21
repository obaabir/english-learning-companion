import { beforeEach, describe, expect, it } from 'vitest'
import { HOME_PAGE, useApp } from '../src/renderer/src/stores/app'

const reset = (): void => useApp.setState({ page: HOME_PAGE, history: [], leaveGuard: null, pendingLeave: null })

describe('Back and Home', () => {
  beforeEach(reset)

  it('Back returns through the screens visited, in order', () => {
    const { setPage, goBack } = useApp.getState()
    setPage('prompts')
    setPage('settings')
    goBack()
    expect(useApp.getState().page).toBe('prompts')
    goBack()
    expect(useApp.getState().page).toBe(HOME_PAGE)
  })

  it('Home goes to the main page; Back with nothing to go back to also goes Home', () => {
    useApp.getState().setPage('flashcards')
    useApp.getState().goHome()
    expect(useApp.getState().page).toBe(HOME_PAGE)
    useApp.setState({ page: 'ielts', history: [] })
    useApp.getState().goBack()
    expect(useApp.getState().page).toBe(HOME_PAGE)
  })
})

describe('Leaving with unsaved work', () => {
  beforeEach(reset)

  it('asks first; "keep editing" stays, "discard" leaves without saving', async () => {
    let saved = 0
    useApp.getState().setPage('prompts')
    useApp.getState().setLeaveGuard({ what: 'the prompt', save: async () => (saved++, true) })
    useApp.getState().goHome()
    expect(useApp.getState().page).toBe('prompts')
    expect(useApp.getState().pendingLeave).toEqual({ to: HOME_PAGE, back: false })
    await useApp.getState().resolveLeave('stay')
    expect(useApp.getState().page).toBe('prompts')
    useApp.getState().goBack()
    await useApp.getState().resolveLeave('discard')
    expect(useApp.getState().page).toBe(HOME_PAGE)
    expect(saved).toBe(0)
  })

  it('"save and leave" saves, then leaves; if saving fails, you stay', async () => {
    let ok = false
    useApp.getState().setPage('notes')
    useApp.getState().setLeaveGuard({ what: 'your note', save: async () => ok })
    useApp.getState().setPage('settings')
    await useApp.getState().resolveLeave('save')
    expect(useApp.getState().page).toBe('notes')
    ok = true
    useApp.getState().setPage('settings')
    await useApp.getState().resolveLeave('save')
    expect(useApp.getState().page).toBe('settings')
    expect(useApp.getState().leaveGuard).toBeNull()
  })
})
