# Third-party notices

## bcryptjs 3.0.3

Used for password hashing in the Worker.

```text
bcrypt.js
---------
Copyright (c) 2012 Nevins Bartolomeo <nevins.bartolomeo@gmail.com>
Copyright (c) 2012 Shane Girish <shaneGirish@gmail.com>
Copyright (c) 2025 Daniel Wirtz <dcode@dcode.io>

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Bundled fonts

Onest and Open Runde are distributed under SIL Open Font License 1.1. Their complete notices remain in `demo/fonts/OFL.txt` and `demo/fonts/OFL-open-runde.txt`.

## Scope and provenance

The root MIT license covers project-owned code and documentation, not the
third-party components below. It asserts no company assignment or trademark
license. Existing custom branding remains subject to its own rights.

- bcryptjs 3.0.3: the installed npm package LICENSE and package metadata agree on
  BSD-3-Clause, matching [upstream v3.0.3 LICENSE](https://github.com/dcodeIO/bcrypt.js/blob/v3.0.3/LICENSE).
  Zero runtime dependencies. The complete notice also lives in licenses/bcryptjs.txt.
- Onest: bundled onest.woff2 identifies as Onest, font version integer 131138
  (2.001). The original download/subsetting revision is not recorded. Preserve
  the supplied copyright and full OFL text beside the font. The
  [upstream license](https://github.com/simpals/onest/blob/main/OFL.txt) identifies
  Onest Project Authors (current upstream points to googlefonts/onest).
- Open Runde Bold: bundled open-runde-700.woff2 identifies as Open Runde Bold,
  version integer 65601 (1.001). The existing credit points to Fontsource; an
  exact download/package revision was not recorded. Its supplied OFL copyright
  is The Inter Project Authors, consistent with the
  [Open Runde upstream LICENSE.txt](https://github.com/lauridskern/open-runde/blob/main/LICENSE.txt).
  This is a rounded Inter derivative; do not replace its notice with MIT.
- assets/icon.svg and demo/icon.svg contain the same two custom paths. Local
  source history describes adoption of the existing postdeploy.dev logo/palette.
  There is no embedded third-party notice or independent authorship/assignment
  record. Origin beyond that record and trademark permissions are unknown; this
  distribution does not invent them. Small inline SVG control icons are embedded
  in demo/js/app.js, with no named icon library or separate attribution found.
  Their original authorship is likewise not independently documented.

The accompanying licenses/assets.json records exact bytes for these assets.
No incompatible copied library was identified in included source. Missing asset
chain-of-title records remain a human release consideration, not a finding that
MIT relicenses unknown third-party rights.

## Dependency inventory and built distribution

licenses/dependencies.json records every resolved lockfile name, version, license
declaration, registry tarball source and integrity, including optional platform
packages. Regenerate with npm run licenses:inventory; --check detects drift.
Only bcryptjs is an application runtime dependency. Other entries (including
Apache-2.0 and dual-licensed Cloudflare tooling) are installer/build/test tools
downloaded by npm ci, not vendored code in this source archive or static assets.
The inventory is lock evidence, not a claim to have audited every tool's internal
binary dependency. Their own installed packages retain their notices; distributing
node_modules or tool binaries would require a separate notice assessment.

The standard build copies project MIT and these notices, including the full BSD
text, into demo/LICENSE.txt and demo/THIRD_PARTY_NOTICES.txt. Font OFL files ship
unchanged with static assets. The Worker entry preserves MIT and full bcrypt BSD
in a legal comment; esbuild's [legal comment rules](https://esbuild.github.io/api/#legal-comments)
explain why a /*! header is used rather than relying on bcrypt's ordinary comment.
Keep notices with custom source/binary bundles. No font is licensed under MIT.
Primary sources checked 2026-11-05. This is a component-specific record, not a
general legal opinion or public-release approval.
