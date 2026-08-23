/**
 * True when the current device has genuine hover capability with a fine
 * pointer (i.e. a mouse/trackpad), per AGENTS.md's node-presentation
 * requirements: touch-only devices (`hover: none`) must not receive the
 * hover-driven auto-expand/auto-collapse behavior meant for a mouse.
 * `NodePresentationManager` calls this once per gesture rather than
 * caching it forever, so a hybrid device (e.g. a laptop with a
 * touchscreen) is judged by whichever input actually triggered the
 * gesture; it does not need to react to `matchMedia` "change" events for
 * this step's scope.
 */
export function supportsHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}
