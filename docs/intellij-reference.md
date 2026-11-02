# IntelliJ reference and verification

## Pinned source

Repository: `JetBrains/intellij-community`.
Revision: `4cc45ea6284376df26b1d290ea82fd55aae33cf7`.

- [MergeConflictModel.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt): base initialization, per-side application and ignore, appending a second side, automatic-resolution guards, and resetting changes.
- [MergeThreesideViewer.java](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java): three-pane presentation and toolbar actions.
- [MergeResolveUtil.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/util/diff/src/com/intellij/diff/comparison/MergeResolveUtil.kt): default simple text resolution, conflict classification, whitespace fallback, and the separately available greedy helper.
- [ByWordRt.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/util/diff/src/com/intellij/diff/comparison/ByWordRt.kt): significant-token matching and suffix-first whitespace correction.
- [ByLineRt.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/util/diff/src/com/intellij/diff/comparison/ByLineRt.kt), [ChangeCorrector.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/util/diff/src/com/intellij/diff/comparison/ChangeCorrector.kt), and [ChunkOptimizer.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/util/diff/src/com/intellij/diff/comparison/ChunkOptimizer.kt): line anchors, exact whitespace correction, and line/word boundary optimization.
- [MyersLCS.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/util/diff/src/com/intellij/util/diff/MyersLCS.kt) and [Reindexer.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/util/diff/src/com/intellij/util/diff/Reindexer.kt): bidirectional sequence matching and filtering unmatchable values.
- [MergeTest.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/diff-impl/tests/testSrc/com/intellij/diff/merge/MergeTest.kt) and [MergeResolveUtilTest.kt](https://github.com/JetBrains/intellij-community/blob/4cc45ea6284376df26b1d290ea82fd55aae33cf7/platform/diff-impl/tests/testSrc/com/intellij/diff/comparison/MergeResolveUtilTest.kt): fixture provenance.

The sources and adapted fixture data are Apache-2.0; attribution is in NOTICE.
`npm run fetch:reference` downloads the pinned files into the ignored
`.reference/intellij` directory for inspection. Runtime builds contain no
JetBrains JARs or Java dependency.

Reference IDE used for executable line and text-resolution comparisons: **CLion
2026.2.3.1, build 262.10968.176**. This is a separate runtime reference, not a
claim that the installed IDE was built from the pinned source commit.

## Implementation

- `src/core/merge.ts` implements logical line ranges and per-side resolution
  state. Logical lines retain the final empty line, which matters for EOF
  insertions and deletions. Snapshots include both text and resolution state.
  Manual edits use the non-greedy range-update rules from IntelliJ's
  `DiffUtil.updateRangeOnModification` and `MergeModelBase`, including damaged
  change boundaries and manually completed deletions.
- `src/core/resolve.ts`, `simpleResolve.ts`, and `wordAlignment.ts` port the
  default simple resolver selected by `ComparisonMergeUtil.tryResolveConflict`,
  including word/newline tokenization, Unicode continuous scripts, punctuation
  matching, word chunk optimization, and three-sided whitespace correction.
  Distinct conflicting insertions remain unresolved. `wordDiff.ts` shares that
  comparison for inline highlighting. No AI or network access participates.
- `src/core/lineAlignment.ts` and `sequenceDiff.ts` port the default ByLineRt
  pipeline: bidirectional Myers, filtering unmatchable elements, important-line
  anchors, gap correction, chunk optimization, and exact whitespace alignment.
  Saved sessions from the previous algorithms preserve their output text and
  compatible resolutions while recomputing boundaries and wand eligibility.
- `src/webview` renders three local Monaco editors, change decorations, gutter
  controls and connectors, mapped scrolling, navigation, and toolbar actions.
  The Result gutter has a wand beside each eligible conflict; the toolbar wand
  processes eligible conflicts throughout the file.
- `src/extension.ts` hosts the custom document, integrates with VS Code's native
  undo/save/backup lifecycle, persists saved sessions, and opens version diffs.
- `src/git.ts` reads complete blobs from index stages 1/2/3. It verifies the
  conflict identity and disk content before saving. Completion stages only the
  selected file; accepting a deleted side stages deletion.
- `src/history.ts` reads Git's line-porcelain blame, including historical paths,
  and supplies unsaved buffers through stdin. Incoming panes resolve their
  merge/rebase revision independently. `blameBridge.ts` validates annotation
  requests against the lines actually displayed before opening a commit.
- `nativeBlame.ts` annotates ordinary files with native editor decorations. It
  never replaces the editor or edits its document. A trusted hover link and
  gutter command open the historical commit/file through `commitInspector.ts`.
  Document versions and attribution checks reject stale links; request
  generations discard outdated results. Document and optional Git API events
  refresh blame. Decorations cover the complete buffer and are cached until
  its attribution changes, so scrolling needs no extension-host messages.
  The column keeps its width while edited text is being reattributed.
  `commitInspector.ts` uses VS Code's public `vscode.changes` command with Git
  revision URIs for the native commit diff. It puts the blamed historical file
  first and focuses it. Only an unavailable Git API uses the custom inline diff.
  Webview workers are fetched as bundled source and started from blobs;
  `importScripts` cannot load extension resources inside VS Code webviews.
  `fileBlameEditor.ts` is only a compatibility adapter for tabs saved by versions
  0.2.0/0.2.1; it returns them to the native editor. It seeds the UTF-8 BOM
  encoding before restoring VS Code's text backup, which otherwise omits the
  old custom editor's encoding preference. No blame custom editor is offered
  for new files.


## Verification coverage

| Requirement | Evidence |
| --- | --- |
| Apply/ignore, per-side state, ordered combination, Ctrl/Cmd modifiers, EOF behavior | 38 adapted upstream merge-action fixtures in `test/intellij.test.ts`; intermediate text, line ranges, and resolution states are asserted. |
| Magic wand, independent words, overlapping deletions, ambiguous insertions, whitespace, punctuation, and Unicode | 26 upstream fixtures plus 1,626 stored oracle cases in `test/intellij.test.ts`; `npm run test:reference` executes the installed IDE’s actual default text-resolver entry point and compares all outputs. |
| Line boundaries around repeated content, braces, indentation, Unicode, and larger files | 1,000 stored CLion oracle cases in `test/lineAlignment.test.ts`; 2,000 one-sided bulk reconstructions, explicit alignment regressions, and a 20,000-line case. `test:reference` compares the same ranges to the installed IDE. |
| Mixed-file bulk application, preservation of manual/ignored work, reset and undo | `test/core.test.ts`, including manual edits crossing a line boundary. |
| Git stages, rebase labels, disk/index interference, deletion, encoding and mode | Temporary-repository integration tests in `test/git.test.ts`. |
| Three panes, real controls, editable result, read-only inputs, undo, navigation, connectors, resize, scroll mapping, worker | Browser interaction tests in `test/ui/merge.spec.ts`. |
| Real extension activation, native document lifecycle, version comparisons, saved resolution state, save and staging | `npm run test:host`; repeats with `MERGER_TEST_AUTO=1` for automatic initial application. Uses a separate VS Code profile and temporary repository. |
| Blame authors, unsaved lines, renames, root commits, incoming merge/rebase revision, binary commit files | Temporary-repository tests in `test/history.test.ts`. |
| Gutter context menu, annotation alignment, commit/file selection, edit refresh and uncommitted rows | `test/ui/blame.spec.ts`; `npm run test:blame` additionally checks native editor retention, combined TypeScript/blame hovers, historical file focus, the native parent/commit diff, empty lines, scrolling through a 2,004-line file with the extension host paused on macOS, commit refresh, native undo and BOM/CRLF save. `MERGER_TEST_LEGACY=1` tests upgrading an unsaved 0.2.1 tab. `MERGER_TEST_FALLBACK_COMMIT=1` disables built-in Git and verifies highlighted removals/additions and a single scrollbar in the fallback. |

## Fidelity differences to track

- Line and word alignment now use ports of the pinned IntelliJ algorithms.
  Comparison work is bounded by a time limit; the extension reports an error or
  leaves a conflict unresolved when it exceeds that limit, rather than invoking
  IntelliJ’s separate patience fallback for extremely expensive inputs. Unicode
  properties come from the host JavaScript runtime, whose Unicode version can
  differ from the reference JVM. Passing the oracle cases establishes the tested
  behavior, not parity on every possible input. jsdiff remains in the UI’s text
  reconciliation and document-edit transport, outside conflict comparison.
- IntelliJ's PSI-based language and import resolution depend on its language
  infrastructure. Those are not included; the magic wand implements the generic
  text resolver. The open-source model's language-resolver interface alone does
  not establish that every IDE-specific implementation is open source.
- The interface uses the IDEA dark palette sampled from the user's
  [reference screenshot](https://resources.jetbrains.com/help/img/idea/2026.2/conflict_resolution_tool_legend_dark.png),
  with locally bundled JetBrains Mono and plain inward-facing gutter controls.
  Toolbar icons are independently drawn. VS Code still provides the surrounding
  editor tab and window, and its layout is not a pixel-identical native dialog.
- Standard Monaco syntax highlighting is embedded locally. IntelliJ inspections
  and the host's third-party language extensions are not available in these
  editors.
- Ordinary-file blame now keeps the native editor. Its public decoration API
  does not expose direct click handlers or a separate fixed annotation gutter.
  Opening commits uses a hover link or gutter command, and annotations scroll
  horizontally with the code. These remain explicit differences from the
  requested IDEA behavior; preserving the native editor takes precedence over
  the rejected renderer replacement. Custom merge panes retain clickable
  annotation columns. The [IDEA reference](https://resources.jetbrains.com/help/img/idea/2026.2/annotate.png)
  guides the annotation palette and date/author presentation.


The generated line oracle uses seed 18281: 800 short repeated-line cases, 160
Unicode/whitespace cases, and 40 files with 200–399 lines. The text oracle uses
seed 72119: the 26 upstream cases, 1,200 ASCII/punctuation cases, and 400 Unicode
cases. Oracle results were recorded from CLion’s public comparison entry points.
