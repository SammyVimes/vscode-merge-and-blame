# Publishing Merge & Blame

The public source repository is `SammyVimes/vscode-merge-and-blame`.
The live preview is deployed to
<https://sammyvimes.github.io/vscode-merge-and-blame/> by GitHub Actions.

## Marketplace publisher

Create a publisher under your Microsoft account at
<https://marketplace.visualstudio.com/manage> and put its actual ID in the
`publisher` field of `package.json`. `vscode-diff` is the local-development
placeholder until that account is created and confirmed. The display name is
**Merge & Blame** and the extension name is `merge-and-blame`.

The manifest includes an original PNG icon, a dark listing banner, search
keywords, repository/support links, and the preview flag. The README includes a
screenshot and links to the live demo. Apache-2.0 and third-party attribution
files remain in the package.

Build a reviewable package before uploading:

```sh
npm ci
npm run typecheck
npm test
npm run test:ui
npm run package
```

Upload `merge-and-blame-0.3.0.vsix` through the publisher management page.
The web upload uses your Microsoft login and does not require a token in this
repository. For automated publishing, configure Marketplace Trusted Publishing
for GitHub Actions; no Marketplace publishing is enabled by the Pages workflow.

Official instructions:
<https://code.visualstudio.com/api/working-with-extensions/publishing-extension>.

## Existing local installations

The old package ID was `vscode-diff.three-way-merger`. The renamed extension has
a new ID, `<publisher>.merge-and-blame`, so it is a separate extension in VS Code.
When switching, uninstall the old extension locally and in each SSH extension
host, then install the renamed package and reload the windows. Keep one active
copy because both packages contribute the same commands and custom-editor IDs.

Existing `threeWayMerger.*` settings, command IDs and editor view types are
preserved for compatibility. The old name is intentionally retained in these
internal identifiers.
