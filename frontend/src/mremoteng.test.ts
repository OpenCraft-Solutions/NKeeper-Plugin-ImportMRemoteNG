// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Cipher, DEFAULT_MASTER_PASSWORD, FileProblem, readFile } from './mremoteng'

/** An mRemoteNG 2.6 file, its secrets encrypted with the master password, as mRemoteNG writes them. */
async function file(master: string, nodes: (cipher: Cipher) => Promise<string>, attributes = '') {
  const cipher = new Cipher(master, 1000)
  const marker = await cipher.encrypt('ThisIsProtected')
  return `<?xml version="1.0" encoding="utf-8"?>
<mrng:Connections xmlns:mrng="http://mremoteng.org" Name="Connections" Export="false" EncryptionEngine="AES" BlockCipherMode="GCM" KdfIterations="1000" FullFileEncryption="false" Protected="${marker}" ConfVersion="2.6"${attributes}>
${await nodes(cipher)}
</mrng:Connections>`
}

const tree = async (cipher: Cipher) => `
  <Node Name="Servers" Type="Container" Username="ops" Domain="CORP" Password="${await cipher.encrypt('folder-pass')}" Protocol="RDP" Port="3389">
    <Node Name="SQL" Type="Container" InheritUsername="true" InheritDomain="true">
      <Node Name="sql01" Type="Connection" Hostname="10.0.0.5" InheritUsername="true" InheritDomain="true" Protocol="SSH2" Port="22" Password="${await cipher.encrypt('s3cret')}" Descr="Database" />
    </Node>
    <Node Name="app01" Type="Connection" Hostname="app01.corp.lan" InheritUsername="true" InheritPassword="true" InheritProtocol="true" InheritPort="true" />
  </Node>
  <Node Name="top" Type="Connection" Hostname="192.0.2.9" Protocol="VNC" Password="${await cipher.encrypt('vnc')}" />`

describe('reading an mRemoteNG file (1.x)', () => {
  it('resolves inherited settings from folders and decrypts the passwords', async () => {
    const connections = await readFile(await file(DEFAULT_MASTER_PASSWORD, tree), '')

    expect(connections.map((c) => [c.name, c.hostname, c.folderPath, c.protocol, c.port, c.username, c.domain, c.password])).toEqual([
      ['sql01', '10.0.0.5', 'Servers/SQL', 'SSH2', 22, 'ops', 'CORP', 's3cret'],
      ['app01', 'app01.corp.lan', 'Servers', 'RDP', 3389, 'ops', null, 'folder-pass'],
      ['top', '192.0.2.9', null, 'VNC', null, null, null, 'vnc'],
    ])
    expect(connections[0]!.description).toBe('Database')
  })

  it('needs the master password the file was protected with', async () => {
    const protectedFile = await file('my master', tree)

    await expect(readFile(protectedFile, '')).rejects.toMatchObject({ field: 'masterPassword' })
    await expect(readFile(protectedFile, 'wrong')).rejects.toThrow('doesn’t open this file')
    expect((await readFile(protectedFile, 'my master')).map((c) => c.password)).toEqual(['s3cret', 'folder-pass', 'vnc'])
    // A password typed for a file that has none still works.
    expect(await readFile(await file(DEFAULT_MASTER_PASSWORD, tree), 'typed anyway')).toHaveLength(3)
  })

  it('reads a file encrypted whole', async () => {
    const cipher = new Cipher(DEFAULT_MASTER_PASSWORD, 1000)
    const whole = await file(DEFAULT_MASTER_PASSWORD, async () => await cipher.encrypt(await tree(cipher)), '')
    const text = whole.replace('FullFileEncryption="false"', 'FullFileEncryption="true"')

    expect((await readFile(text, '')).map((c) => c.name)).toEqual(['sql01', 'app01', 'top'])
  })

  it('refuses what it can’t read: another cipher, an old format, a DTD, not XML', async () => {
    const good = await file(DEFAULT_MASTER_PASSWORD, tree)
    await expect(readFile(good.replace('BlockCipherMode="GCM"', 'BlockCipherMode="CCM"'), '')).rejects.toThrow('AES-CCM')
    await expect(readFile(good.replace('ConfVersion="2.6"', 'ConfVersion="2.5"'), '')).rejects.toThrow('older mRemoteNG')
    await expect(readFile(`<!DOCTYPE x [<!ENTITY e "x">]>${good}`, '')).rejects.toBeInstanceOf(FileProblem)
    await expect(readFile('not xml', '')).rejects.toThrow('valid XML')
  })
})
