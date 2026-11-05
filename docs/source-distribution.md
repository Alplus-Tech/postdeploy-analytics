# Source distribution

Use Node 24.22.x (24.22.0 verified) and npm 11.x (11.19.1 verified), with
`npm ci`, not an unlocked install. Node's built-in SQLite is required by tests
and offline operations. Installation downloads the exact lockfile packages;
this is not an offline dependency mirror. Python 3 is useful for inspecting the
archive, but is not required by the release command.

From a clean committed clone:

```sh
npm ci
npm run licenses:inventory -- --check
npm run release:source -- .scratch/release-0.1.0
cd .scratch/release-0.1.0
sha256sum -c SHA256SUMS
mkdir extracted
cd extracted
tar -xzf ../postdeploy-analytics-0.1.0.tar.gz
npm ci
npm run typecheck
npm run build
npm test
COMPACT_STORAGE=1 npm test
node --test demo/test/*.test.js
npm run test:install
WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir .scratch/worker-bundle
npm run release:source -- .scratch/reproduced
cmp .scratch/reproduced/postdeploy-analytics-0.1.0.tar.gz ../postdeploy-analytics-0.1.0.tar.gz
```

Run the commands before `cd` from the repository root; subsequent commands run
from the extracted root. The local installer test owns port 8797, starts/stops
its Worker processes and preserves small databases and private evidence locally.
It verifies owner authentication, collection, reports/CSV, backup/isolated restore
and new writes, plus compact activation/retirement/recovery. This is local proof.
Deterministic cloud subprocess tests are mocks; no cloud login, provisioning,
Email delivery, remote import or cutover is exercised by these commands.

Open `demo/index.html?demo=1` after building, or use the local Worker instructions
in [README](../README.md). For deployment follow [operations](operations.md),
including private configuration and explicit target confirmations. Deployment is
a separate operator action; the archive does not perform it automatically.

`release-files.json` is the exact reviewed source allowlist. New product files
must be added explicitly. Git mode requires tracked files and a clean working
tree. Extracted mode verifies every input against `SOURCE_MANIFEST.json` and needs
no Git repository or private files. Extra files are not included. Both modes
reject symlinks (including parent components), traversal, excluded paths,
nonregular inputs and oversized payloads. Output is a new private directory under
`.scratch`, outside the input list. No overwrites. A 10 GiB free-space reserve
is enforced. The archive contains no Git history, credentials, installed packages,
generated JS, databases or logs. Example configuration is deliberately included.

The gzip tar has sorted paths, fixed zero timestamps/owner IDs, 0644 file modes
and no absolute paths. Scripts run through Node/npm. The manifest records version,
source revision and per-file SHA-256/size; `SHA256SUMS` covers it and the archive.
On the supported Node/zlib toolchain two builds, including one from the extracted
archive, must produce identical bytes. This is reproducible source packaging,
not a claim of identical builds across all operating systems/toolchain versions.
The embedded manifest cannot include its own checksum; the external checksum
file covers it. Checksums establish identity, not publisher authenticity.

Project-owned code uses MIT; dependencies and fonts retain their own licenses.
See [third-party notices](../THIRD_PARTY_NOTICES.md) and the exact lock inventory
in `licenses/dependencies.json`. Build copies MIT and third-party notices to static
assets; both font license texts stay beside the fonts. The Worker entry has a
preserved legal comment containing MIT and the complete bcryptjs BSD notice.
Keep these materials with deployed/binary distributions; do not remove legal
comments during custom builds. No source maps are requested by the standard
build; inspect any custom source maps before redistribution.

Only this allowlisted archive is the release candidate. The private repository's
inherited history has not been cleared for publication and must not be made
public based on this packaging work. Public distribution/visibility and
real-account acceptance remain separate
decisions. Reuse the prior clean extracted installation proof only when the
locked dependencies and installation path remain unchanged; it does not replace
a new archive at the final committed revision. Reproduce that final archive into
a second new directory and compare bytes. Do not install duplicate dependencies
merely to repeat already established counts when disk reserve is constrained.
Final local acceptance and finite capacity evidence are scoped in acceptance.md;
neither establishes sustained or deployed capacity. Known timing/storage
limitations are in [performance](performance.md).

Offline compact/upgrade commands budget three source sizes plus 1 MiB of workspace
above the 10 GiB reserve, with a separate backup-destination check. This replaces
a fixed 12 GiB allowance so the shipped small-fixture installer proof can run
without weakening the reserve. Large conversions still need substantial space.
