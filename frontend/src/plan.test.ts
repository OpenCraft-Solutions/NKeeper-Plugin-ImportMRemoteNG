import { describe, expect, it } from 'vitest'
import type { Connection } from './mremoteng'
import { newHostRequest, plan, type Host, type ServiceTypeInfo } from './plan'

const types: ServiceTypeInfo[] = [
  { id: 'ssh', label: 'SSH', defaultPort: 22, settings: [] },
  { id: 'rdp', label: 'RDP', defaultPort: 3389, settings: [] },
]

function connection(overrides: Partial<Connection>): Connection {
  return {
    name: 'web01',
    hostname: '192.0.2.10',
    description: null,
    macAddress: null,
    folderPath: null,
    protocol: 'SSH2',
    port: 22,
    username: 'root',
    domain: null,
    password: 'pw',
    passwordProblem: null,
    ...overrides,
  }
}

function host(overrides: Partial<Host>): Host {
  return {
    id: 'h1',
    name: 'web01',
    hostname: null,
    ipAddress: '192.0.2.10',
    description: null,
    macAddress: null,
    cpuCores: null,
    memoryMiB: null,
    serialNumber: null,
    isVirtualMachine: false,
    tags: [],
    services: [],
    credentials: [],
    jump: null,
    version: 3,
    canManage: true,
    ...overrides,
  }
}

const all = { add: true, update: true, remove: false }

describe('what an import does (1.x)', () => {
  it('joins same-name connections into one host, with each one’s service and login, and the folder as a tag', () => {
    const result = plan(
      [
        connection({ folderPath: 'Servers/Web', macAddress: 'aa-bb-cc-dd-ee-01' }),
        connection({ protocol: 'RDP', port: 3390, username: 'Administrator', domain: 'CORP', password: 'rdp' }),
        connection({ hostname: '192.0.2.99' }),
        connection({ name: 'ica', protocol: 'ICA' }),
        connection({ name: '', hostname: 'x' }),
      ],
      [],
      types,
      all,
    )

    const web = result.add.find((h) => h.name === 'web01')!
    expect(newHostRequest(web)).toMatchObject({
      name: 'web01',
      ipAddress: '192.0.2.10',
      macAddress: 'AA:BB:CC:DD:EE:01',
      tags: [{ name: 'folder', value: 'Servers/Web' }],
      // The default port is left as the type's default.
      services: [{ type: 'ssh', port: null }, { type: 'rdp', port: 3390 }],
      credentials: [{ username: 'root', password: 'pw' }, { username: 'Administrator', domain: 'CORP', password: 'rdp' }],
    })
    expect(result.skipped.map((s) => s.name)).toEqual(['web01', '(no name)'])
    // A host still comes in for a protocol nothing here opens, without that service.
    expect(result.add.find((h) => h.name === 'ica')!.services).toEqual([])
    expect(result.warnings.some((w) => w.startsWith('ica: no loaded plugin connects with ICA'))).toBe(true)
  })

  it('updates a host with what it lacks, keeping the rest and its passwords, and leaves an unchanged one', () => {
    const existing = host({
      tags: [{ name: 'env', value: 'prod' }],
      services: [{ id: 's1', type: 'ssh', label: 'Main', port: null, address: null, settings: {}, disabledTools: [] }],
      credentials: [{ id: 'c1', label: null, username: 'root', domain: null, hasPassword: true, notes: 'keep me', serviceIndexes: null }],
    })
    const result = plan([connection({ folderPath: 'Servers' }), connection({ protocol: 'RDP', port: 3389, username: 'admin', password: 'new' })], [existing], types, all)

    const { request } = result.update[0]!
    expect(request.version).toBe(3)
    expect(request.services).toEqual([
      { id: 's1', type: 'ssh', label: 'Main', port: null, address: null, settings: {}, disabledTools: [] },
      { type: 'rdp', label: null, port: null, address: null, settings: {} },
    ])
    // root's password is kept (it has one); admin is added with its.
    expect(request.credentials).toEqual([
      { id: 'c1', label: null, username: 'root', domain: null, notes: 'keep me', serviceIndexes: null },
      { label: null, username: 'admin', domain: null, password: 'new', serviceIndexes: null },
    ])
    expect(request.tags).toEqual([{ name: 'env', value: 'prod' }, { name: 'folder', value: 'Servers' }])

    const same = host({ services: [{ id: 's1', type: 'ssh', label: null, port: null, address: null, settings: {}, disabledTools: [] }], credentials: [{ id: 'c1', label: null, username: 'root', domain: null, hasPassword: true, notes: null, serviceIndexes: null }] })
    expect(plan([connection({})], [same], types, all).unchanged).toEqual(['web01'])
  })

  it('deletes only hosts the file doesn’t name, only when asked, never for an empty file, and only those the user manages', () => {
    const hosts = [host({ id: 'a', name: 'web01' }), host({ id: 'b', name: 'old01' }), host({ id: 'c', name: 'theirs', canManage: false })]

    expect(plan([connection({})], hosts, types, all).remove).toEqual([])
    expect(plan([connection({})], hosts, types, { ...all, remove: true }).remove.map((h) => h.name)).toEqual(['old01'])
    expect(plan([], hosts, types, { ...all, remove: true }).remove).toEqual([])
    // Two hosts with the name: unclear which, so skipped.
    expect(plan([connection({})], [host({ id: 'a' }), host({ id: 'b' })], types, all).skipped[0]!.reason).toContain('2 hosts')
  })
})
