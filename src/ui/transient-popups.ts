/** A currently open, non-modal contextual surface and the control which
 * opened it. Providers resolve live DOM on demand, avoiding per-render global
 * listeners or retained references to Rete nodes which have been replaced. */
export interface TransientPopupEntry {
  popup: EventTarget
  trigger: EventTarget
  dismiss(): void
  restoreFocus?(): void
}

export type TransientPopupProvider = () => readonly TransientPopupEntry[]

export const TRANSIENT_POPUP_DISMISS_EVENT = 'scadlet-dismiss-transient-popup'

const providers = new Set<TransientPopupProvider>()
let listening = false

/** Shadow-DOM-safe boundary check used by every contextual popup family. */
export function transientPopupContainsPath(entry: Pick<TransientPopupEntry, 'popup' | 'trigger'>, path: readonly EventTarget[]): boolean {
  return path.includes(entry.popup) || path.includes(entry.trigger)
}

/** Dismisses every unrelated entry while preserving a popup chain whose
 * parent and nested submenu both occur in the interaction path. */
export function dismissTransientPopupsOutside(entries: readonly TransientPopupEntry[], path: readonly EventTarget[]): void {
  for (const entry of entries) {
    if (!transientPopupContainsPath(entry, path)) entry.dismiss()
  }
}

/** Registers one component-level provider. The coordinator owns a single set
 * of capture listeners regardless of how often that component re-renders. */
export function registerTransientPopupProvider(provider: TransientPopupProvider): () => void {
  providers.add(provider)
  attachListeners()
  return () => {
    providers.delete(provider)
    if (providers.size === 0) detachListeners()
  }
}

/** Keeps native details disclosure state explicit for assistive technology. */
export function bindTransientDetails(details: HTMLDetailsElement, trigger: HTMLElement): void {
  const sync = (): void => trigger.setAttribute('aria-expanded', String(details.open))
  trigger.setAttribute('aria-haspopup', 'menu')
  details.addEventListener('toggle', sync)
  sync()
}

function currentEntries(): TransientPopupEntry[] {
  return [...providers].flatMap((provider) => [...provider()])
}

function dismissOutside(event: Event): void {
  dismissTransientPopupsOutside(currentEntries(), event.composedPath())
}

function dismissOnKeydown(event: KeyboardEvent): void {
  const entries = currentEntries()
  if (entries.length === 0) return
  if (event.key !== 'Escape') {
    dismissOutside(event)
    return
  }

  const path = event.composedPath()
  const focusedEntry = entries.findLast((entry) => transientPopupContainsPath(entry, path)) ?? entries.at(-1)
  for (const entry of entries) entry.dismiss()
  event.preventDefault()
  event.stopPropagation()
  queueMicrotask(() => focusedEntry?.restoreFocus?.())
}

function attachListeners(): void {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('pointerdown', dismissOutside, true)
  document.addEventListener('click', dismissOutside, true)
  document.addEventListener('wheel', dismissOutside, true)
  document.addEventListener('focusin', dismissOutside, true)
  document.addEventListener('keydown', dismissOnKeydown, true)
}

function detachListeners(): void {
  if (!listening || typeof document === 'undefined') return
  listening = false
  document.removeEventListener('pointerdown', dismissOutside, true)
  document.removeEventListener('click', dismissOutside, true)
  document.removeEventListener('wheel', dismissOutside, true)
  document.removeEventListener('focusin', dismissOutside, true)
  document.removeEventListener('keydown', dismissOnKeydown, true)
}
