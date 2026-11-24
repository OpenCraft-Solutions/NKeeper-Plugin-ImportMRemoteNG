import { useState } from 'react'
import { api, ApiError, type InventoryToolProps } from '@nkeeper/sdk'
import { FileProblem, readFile, type Connection } from './mremoteng'
import { newHostRequest, plan, type Host, type Plan, type ServiceTypeInfo } from './plan'

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const errors = (error.problem as { errors?: Record<string, string[]> } | undefined)?.errors
    return Object.values(errors ?? {})[0]?.[0] ?? (error.message || fallback)
  }
  return error instanceof Error ? error.message : fallback
}

type Step = { kind: 'choose' } | { kind: 'preview'; plan: Plan } | { kind: 'done'; lines: string[]; problems: string[] }

/**
 * 1.x's Import (docs/architecture.md §7.48), as an inventory tool: an mRemoteNG connection file, read and decrypted
 * here, becomes hosts through core's own host API, after a preview.
 */
export function ImportDialog({ close, hostsChanged }: InventoryToolProps) {
  const [file, setFile] = useState<File | null>(null)
  const [masterPassword, setMasterPassword] = useState('')
  const [options, setOptions] = useState({ add: true, update: true, remove: false })
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ field: string; message: string } | null>(null)

  async function preview() {
    if (!file) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const connections: Connection[] = await readFile(await file.text(), masterPassword)
      const [hosts, plugins] = await Promise.all([
        api.get<Host[]>('/api/hosts'),
        api.get<{ state: string; serviceTypes?: ServiceTypeInfo[] | null }[]>('/api/plugins'),
      ])
      const types = plugins.filter((p) => p.state === 'loaded').flatMap((p) => p.serviceTypes ?? [])
      setStep({ kind: 'preview', plan: plan(connections, hosts, types, options) })
    } catch (e) {
      setError({ field: e instanceof FileProblem ? e.field : 'file', message: messageOf(e, 'The file couldn’t be read.') })
    } finally {
      setBusy(false)
    }
  }

  async function apply(planned: Plan) {
    setBusy(true)
    const lines: string[] = []
    const problems: string[] = []
    let added = 0
    let updated = 0
    let removed = 0
    for (const host of planned.add) {
      try {
        await api.post('/api/hosts', newHostRequest(host))
        added++
      } catch (e) {
        problems.push(`${host.name}: ${messageOf(e, 'it couldn’t be added.')}`)
      }
    }
    for (const { host, request } of planned.update) {
      try {
        await api.put(`/api/hosts/${host.id}`, request)
        updated++
      } catch (e) {
        problems.push(`${host.name}: ${messageOf(e, 'it couldn’t be updated.')}`)
      }
    }
    for (const host of planned.remove) {
      try {
        await api.delete(`/api/hosts/${host.id}`)
        removed++
      } catch (e) {
        problems.push(`${host.name}: ${messageOf(e, 'it couldn’t be deleted.')}`)
      }
    }
    lines.push(`Added ${added}, updated ${updated}, deleted ${removed}; ${planned.unchanged.length} unchanged.`)
    setStep({ kind: 'done', lines, problems })
    setBusy(false)
    hostsChanged()
  }

  if (step.kind === 'done') {
    return (
      <div className="nk-imp">
        {step.lines.map((l) => (
          <p key={l} role="status">
            {l}
          </p>
        ))}
        {step.problems.length > 0 ? (
          <div className="nk-imp-error" role="alert">
            Some hosts weren’t changed:
            <ul>
              {step.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="nk-imp-bar nk-imp-end">
          <button type="button" className="nk-imp-button" data-primary="" onClick={close}>
            Close
          </button>
        </div>
      </div>
    )
  }

  if (step.kind === 'preview') {
    const p = step.plan
    const nothing = p.add.length + p.update.length + p.remove.length === 0
    return (
      <div className="nk-imp">
        <p role="status">
          {p.add.length} to add, {p.update.length} to update, {p.remove.length} to delete; {p.unchanged.length} unchanged, {p.skipped.length} skipped.
        </p>
        <Section title="To add" items={p.add.map((h) => `${h.name} (${h.hostname ?? h.ipAddress})`)} />
        <Section title="To update" items={p.update.map((u) => u.host.name)} />
        <Section title="To delete" items={p.remove.map((h) => h.name)} danger />
        <Section title="Skipped" items={p.skipped.map((s) => `${s.name}: ${s.reason}`)} />
        <Section title="Warnings" items={p.warnings} />
        <div className="nk-imp-bar nk-imp-end">
          <button type="button" className="nk-imp-button" disabled={busy} onClick={() => setStep({ kind: 'choose' })}>
            Back
          </button>
          <button type="button" className="nk-imp-button" data-primary="" disabled={busy || nothing} onClick={() => void apply(p)}>
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="nk-imp"
      aria-label="Import an mRemoteNG file"
      onSubmit={(e) => {
        e.preventDefault()
        void preview()
      }}
    >
      <p className="nk-imp-muted">
        An mRemoteNG connection file (confCons.xml, or File ▸ Export as XML). It’s read here, in your browser: passwords are decrypted with the master password and sent
        to NKeeper only as each host’s credentials. Hosts match connections by name.
      </p>
      <label className="nk-imp-field">
        Connection file
        <input type="file" accept=".xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-invalid={error?.field === 'file' ? true : undefined} />
      </label>
      <label className="nk-imp-field">
        Master password
        <input
          className="nk-imp-input"
          type="password"
          autoComplete="off"
          value={masterPassword}
          onChange={(e) => setMasterPassword(e.target.value)}
          aria-invalid={error?.field === 'masterPassword' ? true : undefined}
        />
        <span className="nk-imp-muted">The one set in mRemoteNG; leave it empty if none was set.</span>
      </label>
      <fieldset className="nk-imp-options">
        <legend>What to do</legend>
        <label>
          <input type="checkbox" checked={options.add} onChange={(e) => setOptions({ ...options, add: e.target.checked })} /> Add connections that match no host
        </label>
        <label>
          <input type="checkbox" checked={options.update} onChange={(e) => setOptions({ ...options, update: e.target.checked })} /> Update hosts that match a connection
        </label>
        <label>
          <input type="checkbox" checked={options.remove} onChange={(e) => setOptions({ ...options, remove: e.target.checked })} /> Delete hosts the file doesn’t name
        </label>
      </fieldset>
      {error ? (
        <p className="nk-imp-error" role="alert">
          {error.message}
        </p>
      ) : null}
      <div className="nk-imp-bar nk-imp-end">
        <button type="button" className="nk-imp-button" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="nk-imp-button" data-primary="" disabled={busy || !file}>
          {busy ? 'Reading…' : 'Preview'}
        </button>
      </div>
    </form>
  )
}

function Section({ title, items, danger = false }: { title: string; items: string[]; danger?: boolean }) {
  if (items.length === 0) {
    return null
  }
  return (
    <details open={danger || items.length <= 10}>
      <summary data-danger={danger ? '' : undefined}>
        {title} ({items.length})
      </summary>
      <ul aria-label={title}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  )
}
