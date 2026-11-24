# NKeeper mRemoteNG import plugin

The official `import-mremoteng` plugin for [NKeeper](https://github.com/OpenCraft-Solutions/NKeeper) 2.0: 1.x's Import of mRemoteNG connection files. It lives in a repository of its own and is released on its own, so releasing it isn't a release of NKeeper (NKeeper's `docs/architecture.md` §9). Its design is §7.48 there, on the inventory tools of §7.41.

## What it does

**Import**, above the host tree, for administrators: an mRemoteNG connection file (`confCons.xml`, or File ▸ Export as XML, format 2.6 or later) becomes hosts.
- **Read in the browser.** The dialog parses the XML (no DTDs), resolves each connection's inherited settings from its folders, and decrypts the passwords with the Web Crypto API: AES-GCM, keyed by PBKDF2-HMAC-SHA1 of the master password (mRemoteNG's default, `mR3m`, when none was set). Whole-file encryption is read too. The file and master password never reach the server; passwords do only as each host's credentials.
- **What a connection becomes:** a host with its address, description, MAC address and a `folder` tag for its folder path; a service for its protocol when a loaded plugin provides it (RDP, VNC, SSH, Telnet, HTTP, HTTPS); a credential for its login. Same-name connections to one address become one host.
- **Add, update, delete:** add hosts for new connections, update the host with a connection's name (adding what it lacks, keeping the rest and its existing passwords), and, only when asked, delete hosts the file doesn't name. A preview comes first; nothing changes until it's applied.
- **Through core's own API**, as the administrator: every change is checked and audited as if made by hand.

Its backend, which every package has, contributes nothing and maps no endpoints.

The plugin's ID is `import-mremoteng`, and it is built in: it is signed with NKeeper's official key and installed with NKeeper. It can be turned off (§9.2). It needs SDK 1.14 (`>=1.14.0 <2.0.0`).

## Layout

```text
backend/        the plugin: ImportMRemoteNGPlugin.cs (nothing to contribute), nkeeper-plugin.json, the project
frontend/       the Import dialog, the file reader (mremoteng.ts) and the plan (plan.ts): a Vite library build to dist/index.js
tests/          the backend test, which starts NKeeper's test server with this plugin loaded
.github/        CI and the release workflow
```

It builds against NKeeper's published SDK, never core's source:

| Package | Registry | Used for |
| --- | --- | --- |
| `NKeeper.Abstractions` | GitHub Packages (NuGet) | the backend SDK |
| `NKeeper.Plugin.Build` | GitHub Packages (NuGet) | builds, packs and signs the plugin |
| `NKeeper.Testing` | GitHub Packages (NuGet) | the test server and PostgreSQL fixture |
| `@opencraft-solutions/nkeeper-sdk` | GitHub Packages (npm) | the frontend SDK, imported as `@nkeeper/sdk` |

## Building

You need the .NET 10 SDK (see `global.json`), Node.js 24 (see `.nvmrc`) and Docker for the tests.

GitHub Packages needs a token even for public packages. Make a GitHub personal access token that can read packages (`read:packages`) and give it to the build in the environment. It is never written to the repository:

```bash
export NUGET_USERNAME=<your GitHub user name>
export NUGET_AUTH_TOKEN=<token>
export NODE_AUTH_TOKEN=<token>
```

Then, from the repository root:

```bash
(cd frontend && npm ci && npm run lint && npm run typecheck && npm test)
dotnet restore NKeeper.Plugins.ImportMRemoteNG.slnx
dotnet build NKeeper.Plugins.ImportMRemoteNG.slnx --configuration Release
```

Building the plugin builds its frontend, packs `import-mremoteng-<version>.nkp` into `artifacts/plugins/` and signs it with a development key, which the build creates under `.dev/keys/` on first use. Both are ignored by git. To load the package in a development NKeeper, point `Plugins:Directory` at `artifacts/plugins` and `Plugins:DevelopmentTrustDirectory` at `.dev/keys`.

Pinned versions: NuGet packages are locked in `packages.lock.json` (CI restores with `--locked-mode`), and npm packages in `frontend/package-lock.json`. Run `dotnet restore --force-evaluate` after changing a version.

## Testing

```bash
dotnet test NKeeper.Plugins.ImportMRemoteNG.slnx --configuration Release
```

The backend test needs Docker, for PostgreSQL: it starts NKeeper's test server (from `NKeeper.Testing`) with this plugin's built package and checks it loads. The frontend's tests (`npm test`) cover reading files built with mRemoteNG's own encryption (inheritance, folders, master passwords, whole-file encryption, and what's refused), and what an import adds, updates, deletes and skips.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: it restores from GitHub Packages with the workflow's token, lints, type-checks and tests the frontend, checks formatting, builds, runs the tests and packs the plugin signed with a development key, which it keeps as a build artifact.

## Releasing

1. Raise `version` in `backend/nkeeper-plugin.json` (and keep `frontend/package.json` in step), and merge it to `main`.
2. Tag the merge commit `v<version>`, for example `v0.2.0`, and push the tag.
3. `.github/workflows/release.yml` runs. It checks that the tag matches the manifest's version and is on `main`, builds and tests, and then, in the protected `release` environment, which needs an owner's approval, packs `import-mremoteng-<version>.nkp` signed with the official key and publishes a GitHub release with the package and its SHA-256.

The official key's private half, `NKEEPER_RELEASE_KEY` (a PEM), is a secret of the `release` environment. It is available only to the signing job, goes to memory-backed storage for the packing step alone, and is removed when that step ends. It is never in the repository or in a log.

NKeeper's installer picks the release up when its `deploy/plugins.lock` is updated with the new URL and SHA-256.

## License

MIT, as NKeeper. See [LICENSE](LICENSE).
