## Lime v1.173.0

Simplified Chinese release notes are the primary version.

### Features

- Encrypt Provider credentials with a random passphrase held in the system keyring. Environments without a keyring can explicitly select storage protected by file permissions.

### Fixes

- Remove the legacy XOR credential format and machine-derived fixed keys. Legacy credentials must be removed and entered again; storage failures are reported explicitly.
- Improve multi-Provider and multi-key save, reopen, and delete flows, concurrent-write locking, and failure compensation.

### Improvements and Refactoring

- Remove unused Fabric and React Router dependencies and update production dependencies to address identified critical/high advisories.
- Migrate to Vitest 4 and Vite 6, adapting isolation, constructor mocks, and shared test fixtures.

### Tests and Quality

- Pass all 147 standard frontend batches covering 2,034 test files and all 24 real Electron smoke assertions under the new toolchain.
- Add dependency review, credential storage, and CLI/Electron license distribution checks.
- Full development dependency and Rust audits still have unresolved advisories. Cross-platform keyring and this version’s packaged-app validation remain incomplete.

### Documentation

- Add license and attribution materials, contribution and security reporting guidance, and credential storage modes and limitations.

### Other

- Align app, CLI, and Rust workspace versions to 1.173.0.
- Development requires Node 22 or Node 24 and later; Node 23 is unsupported.

**Full changes**: `v1.172.0` -> `v1.173.0`
