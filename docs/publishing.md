# Publishing Merge & Blame

The public source repository is `SammyVimes/vscode-merge-and-blame`.
The live preview is deployed to
<https://sammyvimes.github.io/vscode-merge-and-blame/> by GitHub Actions.

## Marketplace publisher

The publisher is **Semyon Danilov**, with ID `SemyonDanilov`. The complete
extension ID is `SemyonDanilov.merge-and-blame`. The display name is
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

## Publish from GitHub Actions

The [publishing workflow](https://github.com/SammyVimes/vscode-merge-and-blame/actions/workflows/publish.yml)
uses Marketplace Trusted Publishing with GitHub's OIDC identity. It does not
need a PAT or a repository secret.

Configure this once under **Trusted Publishing → Create** in the
[publisher management page](https://marketplace.visualstudio.com/manage/publishers/SemyonDanilov):

| Field | Value |
| --- | --- |
| Policy name | `Merge & Blame releases` |
| Repository owner | `SammyVimes` |
| Repository | `vscode-merge-and-blame` |
| Workflow | `publish.yml` |
| Environment | Leave empty; this workflow does not use a GitHub environment. |

Then choose **Run workflow** on `main` to publish the current version. Enable
**Build and test the VSIX without publishing** for a dry run. Both modes check
the publisher/version, run the core and browser tests, and upload a VSIX
artifact. Publishing uses that exact tested artifact in a separate job.

Pushing a tag such as `v0.3.0` also publishes automatically. Its version must
match `package.json` and `package-lock.json`; a mismatch fails before publishing.
For subsequent releases, update both package versions and the changelog before
creating the tag. A Marketplace version can only be published once.

The Pages workflow only deploys the browser preview. Ordinary pushes to `main`
do not publish an extension release.

A successful upload does not mean that the public listing is ready. Marketplace
validates releases asynchronously; the item page can return 404 while the package
is already downloadable. The workflow separately checks the validated catalog
and the public page, and reports an accepted upload separately from confirmed
public availability. If validation does not complete, check the publisher
dashboard for the service's status or error before attempting another upload.

Manual upload remains available: choose **New extension → Visual Studio Code**
on the publisher page and upload the generated VSIX.

Official instructions:
<https://code.visualstudio.com/api/working-with-extensions/publishing-extension>.

## Existing local installations

The old package ID was `vscode-diff.three-way-merger`. The renamed extension has
a new ID, `SemyonDanilov.merge-and-blame`, so it is a separate extension in VS Code.
When switching, uninstall the old extension locally and in each SSH extension
host, then install the renamed package and reload the windows. Keep one active
copy because both packages contribute the same commands and custom-editor IDs.

Existing `threeWayMerger.*` settings, command IDs and editor view types are
preserved for compatibility. The old name is intentionally retained in these
internal identifiers.

Saved merge sessions are also read from the previous extension's workspace
storage directory when their Git index and saved-file fingerprints still match.
Subsequent saves use the renamed extension's storage directory.
