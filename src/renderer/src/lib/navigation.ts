import { useEffect, useRef } from 'react'
import { useApp, type LeaveGuard } from '@renderer/stores/app'

/**
 * While `dirty`, leaving the page (Back, Home, the menu, the side bar…) asks first:
 * save, discard, or keep editing. `save` resolves false if saving failed.
 */
export function useLeaveGuard(what: string, dirty: boolean, save: () => Promise<boolean>): void {
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!dirty) return
    const guard: LeaveGuard = { what, save: () => saveRef.current() }
    useApp.getState().setLeaveGuard(guard)
    return () => {
      // Only remove our own guard (another page may have registered one since).
      if (useApp.getState().leaveGuard === guard) useApp.getState().setLeaveGuard(null)
    }
  }, [what, dirty])
}

/** Open dismissible layers, most recent last: Escape closes only the top one. */
const escapeStack: { current: () => void }[] = []
let listening = false

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || !escapeStack.length) return
  e.preventDefault()
  escapeStack[escapeStack.length - 1].current()
}

/** Escape closes this dialog / panel / overlay while it is open (only the top-most one). */
export function useEscape(onClose: () => void, open = true): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!open) return
    const entry = { current: () => ref.current() }
    escapeStack.push(entry)
    if (!listening) {
      window.addEventListener('keydown', onEscape)
      listening = true
    }
    return () => {
      const i = escapeStack.indexOf(entry)
      if (i >= 0) escapeStack.splice(i, 1)
    }
  }, [open])
}
