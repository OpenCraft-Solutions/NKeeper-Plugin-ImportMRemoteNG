import type { Connection } from './mremoteng'

/** What the plan needs of core's hosts and service types (`GET /api/hosts`, `GET /api/plugins`). */
export interface Host {
  id: string
  name: string
  hostname: string | null
  ipAddress: string | null
  description: string | null
  macAddress: string | null
  cpuCores: number | null
  memoryMiB: number | null
  serialNumber: string | null
  isVirtualMachine: boolean
  tags: { name: string; value: string | null }[]
  services: { id: string; type: string; label: string | null; port: number | null; address: string | null; settings: Record<string, unknown>; disabledTools: string[] }[]
  credentials: { id: string; label: string | null; username: string | null; domain: string | null; hasPassword: boolean; notes: string | null; serviceIndexes: number[] | null }[]
  jump: { hostId: string; serviceId: string | null; credentialId: string | null } | null
  version: number
  canManage: boolean
}

export interface ServiceTypeInfo {
  id: string
  label: string
  defaultPort: number | null
  settings: { key: string; required: boolean }[]
}

/** The tag holding a host's mRemoteNG folder path, e.g. `folder: Servers/SQL`. */
export const FOLDER_TAG = 'folder'
/** The label of a credential with a password but no user name (VNC, say). */
export const PASSWORD_ONLY_LABEL = 'mRemoteNG'

/** mRemoteNG's protocols, and the service type each becomes when a loaded plugin provides it. */
const PROTOCOL_TYPES: Record<string, string> = { RDP: 'rdp', VNC: 'vnc', SSH1: 'ssh', SSH2: 'ssh', TELNET: 'telnet', HTTP: 'http', HTTPS: 'https' }

interface Login {
  username: string | null
  domain: string | null
  password: string | null
}

/** A host as the file describes it: one or more same-name connections to one address. */
export interface FileHost {
  name: string
  hostname: string | null
  ipAddress: string | null
  description: string | null
  macAddress: string | null
  folders: string[]
  services: { type: string; port: number | null }[]
  logins: Login[]
}

export interface Skip {
  name: string
  reason: string
}

export interface Plan {
  add: FileHost[]
  update: { host: Host; request: HostRequest }[]
  unchanged: string[]
  remove: Host[]
  skipped: Skip[]
  warnings: string[]
}

/** Core's host request (`POST /api/hosts`, `PUT /api/hosts/{id}` with the version it's based on). */
export interface HostRequest {
  name: string
  hostname: string | null
  ipAddress: string | null
  description: string | null
  macAddress: string | null
  cpuCores: number | null
  memoryMiB: number | null
  serialNumber: string | null
  isVirtualMachine: boolean
  tags: { name: string; value: string | null }[]
  services: { id?: string; type: string; label: string | null; port: number | null; address: string | null; settings: Record<string, unknown>; disabledTools?: string[] }[]
  credentials: { id?: string; label: string | null; username: string | null; domain: string | null; password?: string; notes?: string | null; serviceIndexes: number[] | null }[]
  jump?: { hostId: string; serviceId: string | null; credentialId: string | null } | null
  version?: number
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOSTNAME = /^(?=.{1,253}\.?$)[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*\.?$/
const MAC = /^[0-9A-Fa-f]{12}$/

function address(text: string): { hostname: string | null; ipAddress: string | null } | null {
  const ip = IPV4.exec(text)
  if (ip && ip.slice(1).every((o) => Number(o) <= 255)) {
    return { hostname: null, ipAddress: ip.slice(1).map(Number).join('.') }
  }
  if (text.includes(':') && /^[0-9A-Fa-f:.]+$/.test(text)) {
    return { hostname: null, ipAddress: text.toLowerCase() }
  }
  return HOSTNAME.test(text) ? { hostname: text, ipAddress: null } : null
}

function mac(text: string): string | null {
  const hex = text.replace(/[:\-.\s]/g, '')
  return MAC.test(hex) ? (hex.match(/../g) ?? []).join(':').toUpperCase() : null
}

const same = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/** Turns connections into hosts, as 1.x did: checks the addresses, and joins same-name connections to one address. */
export function fileHosts(connections: Connection[], types: ServiceTypeInfo[], skipped: Skip[], warnings: string[]): FileHost[] {
  const hosts = new Map<string, FileHost>()
  for (const connection of connections) {
    const name = connection.name
    if (!name) {
      skipped.push({ name: '(no name)', reason: `A connection to “${connection.hostname}” has no name.` })
      continue
    }
    if (name.length > 200) {
      skipped.push({ name, reason: 'The name is longer than 200 characters.' })
      continue
    }
    if (!connection.hostname) {
      skipped.push({ name, reason: 'It has no hostname or IP address.' })
      continue
    }
    const at = address(connection.hostname)
    if (!at) {
      skipped.push({ name, reason: `“${connection.hostname}” isn’t a valid hostname or IP address.` })
      continue
    }
    if (connection.passwordProblem) {
      warnings.push(`${name}: ${connection.passwordProblem}.`)
    }
    let host = hosts.get(name.toLowerCase())
    if (!host) {
      host = { name, ...at, description: null, macAddress: null, folders: [], services: [], logins: [] }
      hosts.set(name.toLowerCase(), host)
    } else if (!same(host.hostname, at.hostname) || host.ipAddress !== at.ipAddress) {
      skipped.push({ name, reason: 'Another connection in the file has this name and a different address; only the first was imported.' })
      continue
    }
    merge(host, connection, types, warnings)
  }
  return [...hosts.values()]
}

function merge(host: FileHost, connection: Connection, types: ServiceTypeInfo[], warnings: string[]) {
  host.description ??= connection.description ? connection.description.slice(0, 4000) : null
  if (!host.macAddress && connection.macAddress) {
    host.macAddress = mac(connection.macAddress)
    if (!host.macAddress) {
      warnings.push(`${host.name}: the MAC address “${connection.macAddress}” isn’t valid, so it was left out.`)
    }
  }
  if (connection.folderPath && !host.folders.some((f) => same(f, connection.folderPath))) {
    if (connection.folderPath.length <= 255) {
      host.folders.push(connection.folderPath)
    } else {
      warnings.push(`${host.name}: its folder path is longer than 255 characters, so it has no folder tag.`)
    }
  }
  const typeId = PROTOCOL_TYPES[(connection.protocol ?? '').toUpperCase()]
  const type = typeId ? types.find((t) => t.id === typeId) : undefined
  if (!type) {
    // The host and its login still come in; only the service nothing here opens is left out.
    warnings.push(`${host.name}: no loaded plugin connects with ${connection.protocol ?? 'this protocol'}, so that service was left out.`)
  } else if (type.settings.some((s) => s.required)) {
    warnings.push(`${host.name}: ${type.label} needs settings the file doesn’t have, so that service was left out.`)
  } else if (!host.services.some((s) => s.type === type.id)) {
    host.services.push({ type: type.id, port: connection.port === type.defaultPort ? null : connection.port })
  }
  if (connection.username === null && connection.password === null) {
    return
  }
  if ((connection.username?.length ?? 0) > 256 || (connection.domain?.length ?? 0) > 256 || (connection.password?.length ?? 0) > 1024) {
    warnings.push(`${host.name}: its user name, domain or password is too long, so its login was left out.`)
    return
  }
  const existing = host.logins.find((l) => same(l.username, connection.username) && same(l.domain, connection.domain))
  if (!existing) {
    host.logins.push({ username: connection.username, domain: connection.domain, password: connection.password })
  } else if (existing.password === null && connection.password !== null) {
    existing.password = connection.password
  }
}

/** A new host's request for core. */
export function newHostRequest(host: FileHost): HostRequest {
  return {
    name: host.name,
    hostname: host.hostname,
    ipAddress: host.ipAddress,
    description: host.description,
    macAddress: host.macAddress,
    cpuCores: null,
    memoryMiB: null,
    serialNumber: null,
    isVirtualMachine: false,
    tags: host.folders.map((value) => ({ name: FOLDER_TAG, value })),
    services: host.services.map((s) => ({ type: s.type, label: null, port: s.port, address: null, settings: {} })),
    credentials: host.logins.map((l) => ({
      label: l.username === null ? PASSWORD_ONLY_LABEL : null,
      username: l.username,
      domain: l.domain,
      ...(l.password !== null ? { password: l.password } : {}),
      serviceIndexes: null,
    })),
  }
}

/**
 * An existing host with the file's details, as 1.x applied them, keeping what the file doesn't mention: its address,
 * description and MAC address from the file; services and credentials added unless it has them (the same type; the
 * same account, or the password-only one); a password filled in only where it has none, since secrets are write-only;
 * and its folder tags as the file has them. Null when nothing would change.
 */
export function updatedHostRequest(existing: Host, file: FileHost): HostRequest | null {
  let changed = false
  const request: HostRequest = {
    name: existing.name,
    hostname: existing.hostname,
    ipAddress: existing.ipAddress,
    description: existing.description,
    macAddress: existing.macAddress,
    cpuCores: existing.cpuCores,
    memoryMiB: existing.memoryMiB,
    serialNumber: existing.serialNumber,
    isVirtualMachine: existing.isVirtualMachine,
    tags: existing.tags.map((t) => ({ name: t.name, value: t.value })),
    services: existing.services.map((s) => ({ id: s.id, type: s.type, label: s.label, port: s.port, address: s.address, settings: s.settings, disabledTools: s.disabledTools })),
    credentials: existing.credentials.map((c) => ({ id: c.id, label: c.label, username: c.username, domain: c.domain, notes: c.notes, serviceIndexes: c.serviceIndexes })),
    jump: existing.jump,
    version: existing.version,
  }
  if (!same(request.hostname, file.hostname) || request.ipAddress !== file.ipAddress) {
    request.hostname = file.hostname
    request.ipAddress = file.ipAddress
    changed = true
  }
  if (file.description !== null && request.description !== file.description) {
    request.description = file.description
    changed = true
  }
  if (file.macAddress !== null && request.macAddress !== file.macAddress) {
    request.macAddress = file.macAddress
    changed = true
  }
  for (const service of file.services) {
    const has = request.services.find((s) => s.type === service.type)
    if (!has) {
      request.services.push({ type: service.type, label: null, port: service.port, address: null, settings: {} })
      changed = true
    } else if (has.port !== service.port) {
      has.port = service.port
      changed = true
    }
  }
  for (const login of file.logins) {
    const index = existing.credentials.findIndex((c) =>
      login.username !== null ? same(c.username, login.username) && same(c.domain, login.domain) : c.username === null && c.label === PASSWORD_ONLY_LABEL,
    )
    if (index < 0) {
      request.credentials.push({
        label: login.username === null ? PASSWORD_ONLY_LABEL : null,
        username: login.username,
        domain: login.domain,
        ...(login.password !== null ? { password: login.password } : {}),
        serviceIndexes: null,
      })
      changed = true
    } else if (login.password !== null && !existing.credentials[index]!.hasPassword) {
      request.credentials[index]!.password = login.password
      changed = true
    }
  }
  // The folder tags follow the file: moved connections move, and top-level ones lose theirs.
  const folders = request.tags.filter((t) => t.name.toLowerCase() === FOLDER_TAG)
  const now = folders.map((t) => t.value ?? '').sort()
  const wanted = [...file.folders].sort()
  if (now.join('\n') !== wanted.join('\n')) {
    request.tags = [...request.tags.filter((t) => t.name.toLowerCase() !== FOLDER_TAG), ...file.folders.map((value) => ({ name: FOLDER_TAG, value }))]
    changed = true
  }
  return changed ? request : null
}

/** What applying the file would do, against the hosts the administrator can manage. */
export function plan(connections: Connection[], hosts: Host[], types: ServiceTypeInfo[], options: { add: boolean; update: boolean; remove: boolean }): Plan {
  const skipped: Skip[] = []
  const warnings: string[] = []
  const result: Plan = { add: [], update: [], unchanged: [], remove: [], skipped, warnings }
  const manageable = hosts.filter((h) => h.canManage)
  for (const file of fileHosts(connections, types, skipped, warnings)) {
    const matches = manageable.filter((h) => same(h.name, file.name))
    if (matches.length > 1) {
      skipped.push({ name: file.name, reason: `${matches.length} hosts here have this name, so it’s unclear which one to update.` })
    } else if (matches.length === 1) {
      if (!options.update) {
        skipped.push({ name: file.name, reason: 'Already here, and Update is off.' })
        continue
      }
      const request = updatedHostRequest(matches[0]!, file)
      if (request) {
        result.update.push({ host: matches[0]!, request })
      } else {
        result.unchanged.push(file.name)
      }
    } else if (options.add) {
      result.add.push(file)
    } else {
      skipped.push({ name: file.name, reason: 'Not here, and Add is off.' })
    }
  }
  if (options.remove) {
    // Every name in the file counts, skipped connections' too: their hosts stay.
    const names = new Set(connections.map((c) => c.name.toLowerCase()).filter((n) => n.length > 0))
    if (names.size > 0) {
      result.remove = manageable.filter((h) => !names.has(h.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name))
    } else {
      warnings.push('The file has no connections, so Delete would remove every host: nothing is deleted.')
    }
  }
  return result
}
