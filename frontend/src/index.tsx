import { adoptStyles, definePlugin } from '@nkeeper/sdk'
import { ImportDialog } from './ImportDialog'

/** The dialog's styles, adopted as a constructable stylesheet (the shell's policy blocks <style> elements, §7.14). */
const styles = `
.nk-imp { display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.875rem; }
.nk-imp p { margin: 0; }
.nk-imp-muted { color: var(--color-text-muted, #9aa8c1); }
.nk-imp-field { display: flex; flex-direction: column; gap: 0.25rem; font-weight: 600; }
.nk-imp-field .nk-imp-muted { font-weight: 400; }
.nk-imp-input { min-height: 2rem; padding: 0 0.5rem; border: 1px solid var(--color-border-strong, #33456b); border-radius: var(--radius-md, 8px);
  background: var(--color-input-bg, #0b1220); color: inherit; font: inherit; font-weight: 400; }
.nk-imp-options { display: flex; flex-direction: column; gap: 0.25rem; margin: 0; padding: 0.5rem 0.75rem; border: 1px solid var(--color-border, #233150); border-radius: var(--radius-md, 8px); }
.nk-imp-error { margin: 0; padding: 0.5rem 0.75rem; border: 1px solid var(--color-danger-border, #b91c1c); border-radius: var(--radius-md, 8px); color: var(--color-danger-text, #fca5a5); }
.nk-imp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.nk-imp-end { justify-content: flex-end; }
.nk-imp-button { display: inline-flex; align-items: center; min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--color-border-strong, #33456b);
  border-radius: var(--radius-md, 8px); background: transparent; color: inherit; font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.nk-imp-button:disabled { opacity: 0.5; cursor: default; }
.nk-imp-button[data-primary] { background: var(--color-accent, #2563eb); border-color: var(--color-accent, #2563eb); color: var(--color-on-accent, #fff); }
.nk-imp details > summary { cursor: pointer; font-weight: 620; }
.nk-imp details > summary[data-danger] { color: var(--color-danger-text, #fca5a5); }
.nk-imp ul { margin: 0.25rem 0 0; padding-left: 1.25rem; max-height: 12rem; overflow: auto; }
`

const plugin = definePlugin({
  id: 'import-mremoteng',
  activate() {
    adoptStyles(styles)
  },
  // SDK 1.14 (§7.41): 1.x's Import button above the host tree, for administrators.
  inventoryTools: { 'import-mremoteng': { label: 'Import', title: 'Import an mRemoteNG connection file', view: ImportDialog } },
})

export default plugin
