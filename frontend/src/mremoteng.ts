/**
 * mRemoteNG's connection file (confCons.xml, or File ▸ Export), format 2.6 or later (docs/architecture.md §7.48), read
 * and decrypted in the browser, ported from 1.x's MRemoteNgFile: nested `Node` elements (folders and connections)
 * whose attributes hold every setting, with `Inherit*` flags taking a value from the parent folder.
 *
 * Secrets are AES-GCM: base64 of salt (16 bytes), nonce (16 bytes), ciphertext and tag, with the key derived by
 * PBKDF2-HMAC-SHA1 (`KdfIterations`) from the master password, and the salt as associated data. Without a master
 * password mRemoteNG uses "mR3m". The root's `Protected` attribute is an encrypted marker that shows whether the
 * password is right.
 */

export const DEFAULT_MASTER_PASSWORD = 'mR3m'
const SALT_LENGTH = 16
const NONCE_LENGTH = 16
const TAG_LENGTH = 16
const SUPPORTED_VERSION = 2.6

/** One connection, with inherited values resolved and its password decrypted. */
export interface Connection {
  name: string
  hostname: string
  description: string | null
  macAddress: string | null
  /** The containing folders, outermost first, joined with "/"; null at the top level. */
  folderPath: string | null
  /** mRemoteNG's protocol name, e.g. RDP or SSH2. */
  protocol: string | null
  port: number | null
  username: string | null
  domain: string | null
  password: string | null
  /** Why the password was left out, when it couldn't be decrypted. */
  passwordProblem: string | null
}

/** The file can't be read, or the master password is missing or wrong; `field` says which to fix. */
export class FileProblem extends Error {
  readonly field: 'file' | 'masterPassword'

  constructor(field: 'file' | 'masterPassword', message: string) {
    super(message)
    this.field = field
  }
}

/** Settings a node can inherit from its folder: attribute → its Inherit flag. */
const INHERITABLE: Record<string, string> = {
  Protocol: 'InheritProtocol',
  Port: 'InheritPort',
  Username: 'InheritUsername',
  Domain: 'InheritDomain',
  Password: 'InheritPassword',
  Descr: 'InheritDescription',
  MacAddress: 'InheritMacAddress',
}

const trimToNull = (value: string | null | undefined) => (value && value.trim() !== '' ? value.trim() : null)

function parseXml(text: string): Document {
  // No DTDs: an entity declaration is refused rather than expanded.
  if (/<!DOCTYPE/i.test(text)) {
    throw new FileProblem('file', 'The file declares a DTD, which an mRemoteNG file never does, so it wasn’t read.')
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new FileProblem('file', 'The file isn’t valid XML.')
  }
  return doc
}

const nodes = (parent: Element) => Array.from(parent.children).filter((e) => e.localName === 'Node')

function base64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value.trim()), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** Decrypts mRemoteNG values with one master password; keys are derived once per salt. */
export class Cipher {
  private readonly keys = new Map<string, Promise<CryptoKey>>()
  private readonly password: string
  private readonly iterations: number

  constructor(password: string, iterations: number) {
    this.password = password
    this.iterations = iterations
  }

  private key(salt: Uint8Array): Promise<CryptoKey> {
    const id = Array.from(salt).join(',')
    let key = this.keys.get(id)
    if (!key) {
      key = crypto.subtle
        .importKey('raw', new TextEncoder().encode(this.password), 'PBKDF2', false, ['deriveKey'])
        .then((base) =>
          crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-1', salt: salt as BufferSource, iterations: this.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt']),
        )
      this.keys.set(id, key)
    }
    return key
  }

  /** The plaintext, or null when the value is malformed or the password is wrong. */
  async decrypt(value: string): Promise<string | null> {
    const raw = base64(value)
    if (!raw || raw.length < SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH) {
      return null
    }
    const salt = raw.slice(0, SALT_LENGTH)
    const nonce = raw.slice(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH)
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: salt as BufferSource, tagLength: TAG_LENGTH * 8 },
        await this.key(salt),
        raw.slice(SALT_LENGTH + NONCE_LENGTH) as BufferSource,
      )
      return new TextDecoder().decode(plain)
    } catch {
      return null
    }
  }

  /** Encrypts a value as mRemoteNG does (the tests build files with it). */
  async encrypt(plaintext: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH))
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: salt, tagLength: TAG_LENGTH * 8 }, await this.key(salt), new TextEncoder().encode(plaintext)),
    )
    return btoa(String.fromCharCode(...salt, ...nonce, ...sealed))
  }
}

/** The master password that opens the file: the one given, else mRemoteNG's default. */
async function resolvePassword(root: Element, masterPassword: string, iterations: number): Promise<string> {
  const marker = root.getAttribute('Protected')
  if (!marker) {
    return masterPassword || DEFAULT_MASTER_PASSWORD
  }
  if (masterPassword && (await new Cipher(masterPassword, iterations).decrypt(marker)) !== null) {
    return masterPassword
  }
  // A password typed for a file that has none still works.
  if ((await new Cipher(DEFAULT_MASTER_PASSWORD, iterations).decrypt(marker)) !== null) {
    return DEFAULT_MASTER_PASSWORD
  }
  throw new FileProblem(
    'masterPassword',
    masterPassword ? 'That master password doesn’t open this file.' : 'This file is protected with a master password. Enter the one set in mRemoteNG.',
  )
}

/** The node's value, or its nearest folder's when the node (and that folder) inherits it. */
function resolve(node: Element, folders: Element[], attribute: string): string | null {
  let current = node
  for (let level = folders.length - 1; ; level--) {
    const flag = INHERITABLE[attribute]
    const inherits = flag !== undefined && current.getAttribute(flag)?.toLowerCase() === 'true'
    if (!inherits || level < 0) {
      return current.getAttribute(attribute)
    }
    current = folders[level]!
  }
}

/** Parses and decrypts the file. */
export async function readFile(text: string, masterPassword: string): Promise<Connection[]> {
  const root = parseXml(text).documentElement
  if (root.localName !== 'Connections') {
    throw new FileProblem('file', 'This isn’t an mRemoteNG connection file (confCons.xml or an mRemoteNG XML export).')
  }
  const version = Number.parseFloat(root.getAttribute('ConfVersion') ?? '')
  if (!(version >= SUPPORTED_VERSION)) {
    throw new FileProblem(
      'file',
      `This file is from an older mRemoteNG (format ${root.getAttribute('ConfVersion') ?? 'unknown'}). Open it in a current mRemoteNG, save it, then import it again.`,
    )
  }
  const engine = root.getAttribute('EncryptionEngine') ?? 'AES'
  const mode = root.getAttribute('BlockCipherMode') ?? 'GCM'
  if (engine.toUpperCase() !== 'AES' || mode.toUpperCase() !== 'GCM') {
    throw new FileProblem('file', `This file uses ${engine}-${mode} encryption. NKeeper reads AES-GCM, mRemoteNG’s default: choose it in mRemoteNG’s Options ▸ Security, save, then import again.`)
  }
  const parsedIterations = Number.parseInt(root.getAttribute('KdfIterations') ?? '', 10)
  const iterations = Number.isInteger(parsedIterations) && parsedIterations > 0 ? parsedIterations : 1000
  const cipher = new Cipher(await resolvePassword(root, masterPassword, iterations), iterations)

  let top = nodes(root)
  if (root.getAttribute('FullFileEncryption')?.toLowerCase() === 'true') {
    // The whole tree is one encrypted value: the XML of the top-level nodes.
    const tree = await cipher.decrypt(root.textContent ?? '')
    if (tree === null) {
      throw new FileProblem('file', 'The file’s encrypted contents couldn’t be read.')
    }
    top = nodes(parseXml(`<Nodes>${tree}</Nodes>`).documentElement)
  }

  const connections: Connection[] = []
  const collect = async (node: Element, folders: Element[]) => {
    const type = node.getAttribute('Type')?.toLowerCase()
    if (type === 'container') {
      for (const child of nodes(node)) {
        await collect(child, [...folders, node])
      }
      return
    }
    if (type !== 'connection') {
      return
    }
    const value = (attribute: string) => resolve(node, folders, attribute)
    const port = Number.parseInt(value('Port') ?? '', 10)
    let password: string | null = null
    let passwordProblem: string | null = null
    const encrypted = value('Password')
    if (encrypted) {
      password = await cipher.decrypt(encrypted)
      passwordProblem = password === null ? 'its password couldn’t be decrypted, so it was left out' : null
    }
    const folderPath = folders
      .map((f) => f.getAttribute('Name')?.trim())
      .filter((n): n is string => !!n)
      .join('/')
    connections.push({
      name: node.getAttribute('Name')?.trim() ?? '',
      hostname: node.getAttribute('Hostname')?.trim() ?? '',
      description: trimToNull(value('Descr')),
      macAddress: trimToNull(value('MacAddress')),
      folderPath: folderPath || null,
      protocol: trimToNull(value('Protocol')),
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null,
      username: trimToNull(value('Username')),
      domain: trimToNull(value('Domain')),
      password: password || null,
      passwordProblem,
    })
  }
  for (const node of top) {
    await collect(node, [])
  }
  return connections
}
