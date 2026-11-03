# Changelog

## 0.3.4

- Fetch the merge UI as a gzip bundle and inflate it in the webview; retain the raw script as a compatibility fallback.
- Include compressed initial merge state in the HTML, removing the ready/state round trip before first rendering.
- Request fresh host state when reloading a previously initialized webview, preserving unsaved edits and resolution history.
- Record compressed asset loading and state initialization in opening diagnostics.

## 0.3.3

- Minify the merge UI, commit viewer and editor worker in production builds.
- Read saved sessions on the workspace host and remove duplicate cache lookups, avoiding repeated remote filesystem round trips on every opening.
- Reuse preflight merge inputs after checking the current index, file contents and permissions; reload if they changed during the handoff.
- Retain opening timings for comparison with 0.3.2.

## 0.3.2

- Add opening diagnostics for Git input reads, saved-state restoration, merge computation, webview startup, browser resources and the first rendered merge frame.
- Add **Show Opening Timings** and **Copy Opening Timings**, retaining the latest 20 openings for comparison.
- Record fresh openings, reopened documents and existing-view reveals with separate host and browser clocks.
- Preserve the previous loading behavior and bundle size for performance diagnosis.

## 0.3.1

- Open Merge & Blame from Git's existing **Resolve in Merge Editor** button.
- Add **Use As Default Merge Editor**, enabled by default, with immediate opt-out.
- Preserve unsaved text before switching merge tools; leave unsupported merges to VS Code.
- Restore saved merge sessions across path aliases and the previous extension ID.

## 0.3.0

- Rename the extension to **Merge & Blame**.
- Add a GitHub Pages live preview with representative merge samples and demo history.
- Add Marketplace artwork, repository links, and automated build checks.
- Preserve existing `threeWayMerger.*` command and settings IDs.

## 0.2.3

- Keep native blame annotations installed throughout the file, eliminating scroll loading and horizontal code shifts.
- Open commits in VS Code's native diff with the blamed historical file focused.
- Fix fallback diff highlighting and its duplicate scrollbar.

## 0.2.2

- Keep ordinary-file Git blame in the native editor, preserving language features, unsaved text, save, and undo.
- Migrate previous custom blame tabs back to the native editor.

## 0.2.1

- Port IntelliJ line alignment, per-side merge actions, and deterministic simple-conflict resolution.
- Add file-wide non-conflicting application and per-conflict magic wands.
