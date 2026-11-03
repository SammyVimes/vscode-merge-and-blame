# Development goal

Build a VS Code extension that faithfully reproduces the JetBrains three-way
merge editor used in IntelliJ IDEA, CLion, and other JetBrains IDEs. The target is
the familiar appearance, controls, and behavior, so a JetBrains user can resolve
conflicts in VS Code using the same workflow.

All merge functionality must run locally using deterministic algorithms, with no
AI integration or AI service dependency, including the magic-wand action.

## Required merge experience

- Three panes: read-only local version on the left, editable merge result in the
  middle, and read-only incoming version on the right.
- Keep the common ancestor (base) available for comparisons. Initialize the
  result from the base, with an option to apply non-conflicting changes
  automatically, matching JetBrains' behavior.
- Place apply arrows and ignore (×) controls beside individual changes, with the
  same per-side resolution behavior as JetBrains.
- Reproduce change and conflict highlighting, word-level differences, connecting
  shapes between panes, and synchronized scrolling.
- Use the colors and visual style from the supplied [IDEA dark reference](https://resources.jetbrains.com/help/img/idea/2026.2/conflict_resolution_tool_legend_dark.png):
  charcoal editors, blue modifications, gray deletions, green additions, orange
  conflicts, JetBrains Mono, and plain gutter controls.
- Keep the complete apply/ignore button targets inside their diff bubbles,
  including inserted/deleted blocks with an empty counterpart. Use equally sized
  SVG crosses and double chevrons, centered on the same code line, with the
  connecting curve starting beyond the action lane.
- Provide an explicit **Apply All Non-Conflicting Changes** button for the current
  file. Apply all eligible non-conflicting changes from both sides to the middle
  result, preserve manual edits and existing resolutions, and leave conflicts
  untouched. Update resolution counts and support undo of the bulk action.
- Also support applying non-conflicting changes from either side individually.
- Support navigating changes and unresolved conflicts, showing resolution counts,
  and comparing versions against each other and the base.
- Allow direct editing of the middle pane, undo/redo of edits and merge actions,
  and reverting a conflict resolution.
- Integrate with Git conflicts in VS Code, save the resulting file, and provide
  an explicit action to complete resolution of that file. Identify the two sides
  correctly for the Git operation in progress, including rebases.
- Open our merger from Git's existing **Resolve in Merge Editor** button by
  default, with an opt-out to restore VS Code's merger. Preserve unsaved edits
  and forward unsupported merge requests to the original handler.

## Magic wand: Resolve Simple Conflicts

Include JetBrains' magic-wand action as an explicit feature goal. It attempts to
combine changes that can be resolved automatically, including independent edits
to different words within a line that Git reports as conflicting.

Provide both a magic-wand button beside each eligible conflict in the result
gutter and a toolbar action for the whole file. The per-conflict action must
resolve only its selected conflict, with independent undo/redo.

For example:

```text
Base:     render(oldName, oldColor)
Local:    render(newName, oldColor)
Incoming: render(oldName, newColor)
Result:   render(newName, newColor)
```

The action must leave ambiguous conflicts unresolved, preserve manual edits,
update resolution state and counts, and support undo. Keep it available as a
distinct action from applying non-conflicting changes. Review of the resulting
code remains part of the workflow.

The action, merge model, and text-resolution entry point are available in
JetBrains' open-source repository with Apache 2.0 source headers. Porting this
behavior to VS Code is feasible. The current model also supports language-specific
resolution; assess those implementations and dependencies separately before
claiming parity with them.

## Git blame

Reproduce the annotation workflow in the supplied [JetBrains reference](https://resources.jetbrains.com/help/img/idea/2026.2/annotate.png).
Right-clicking the line-number gutter offers **Show Git Blame**. Display a compact,
colored date-and-author column between the line numbers and the code, aligned
with each line and scrolling with it. The action must use the file's existing
tab and retain its filename, unsaved text, and editing/save/undo behavior; it must
not open an additional tab branded as the merge editor. **Hide Git Blame** returns
to the ordinary editor in the same tab.

Clicking a committed annotation opens that commit's details and changed files,
selects the blamed file using its historical filename, and reveals the original
line in its diff. Unsaved or uncommitted lines are visibly identified and do not
link to an unrelated commit. Support ordinary files and individual merge panes;
attribute incoming merge/rebase text to its own revision rather than HEAD.
Use local Git data, with no AI or network dependency.

Once loaded, blame must stay present while scrolling to any part of the file,
without an extension-host round trip or the code shifting horizontally. Keep
the annotation column's width while refreshing after edits. Prefer VS Code's
native commit diff when available, with the blamed historical file focused.
Any fallback must show the commit's changes against its parent, including
visible additions/removals and a single vertical scrollbar.

Ordinary-file blame must preserve the native VS Code editor, including its
language services and other extensions. Swapping its renderer while keeping the
same tab does not satisfy this requirement. The exact JetBrains click/scroll
experience remains the target. VS Code's current public decoration API exposes
hover links rather than click handlers and cannot reserve a fixed annotation
gutter; track that native-editor limitation explicitly. Merge panes can keep
their clickable columns inside the custom merger.


## Implementation approach and acceptance

Use the original implementation and observable JetBrains behavior as references.
Its Java/Kotlin and IntelliJ editor dependencies require a port and a VS Code UI
implementation. A custom editor/webview is a candidate; the architecture is still
to be selected.

Before porting, pin a JetBrains source revision and reference IDE version, inspect
the relevant tests, and preserve required license and attribution notices for
reused code. Track any remaining behavioral differences explicitly.

Validate equivalent operations against the reference IDE using merge fixtures
covering insertions, deletions, overlapping edits, independent edits within one
line, whitespace, manual result edits, and undo/redo. Include a file containing
both conflicting and non-conflicting changes to verify the bulk button applies
only eligible non-conflicting changes and preserves existing work. Acceptance
requires matching both the resulting text and the resolved/unresolved state,
alongside the familiar visual interactions.

The standalone browser preview must offer a substantial, representative sample
with pure insertions from either side, deletions, replacements, same-line word
edits, competing insertions, delete/edit conflicts, unequal block lengths,
whitespace, and file-boundary changes. Provide focused samples and reset controls
so these cases can be inspected without editing a real repository.

## References

The extension implementation and usage are documented in [README.md](README.md).
The pinned source revision, test provenance, verification coverage, and remaining
fidelity differences are tracked in [docs/intellij-reference.md](docs/intellij-reference.md).

- [JetBrains merge editor](https://github.com/JetBrains/intellij-community/blob/master/platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java)
- [Magic-wand action](https://github.com/JetBrains/intellij-community/blob/master/platform/diff-impl/src/com/intellij/diff/merge/MagicResolvedConflictsAction.kt)
- [Merge model and text auto-resolver](https://github.com/JetBrains/intellij-community/blob/master/platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt)
- [Text conflict resolution entry point](https://github.com/JetBrains/intellij-community/blob/master/platform/util/diff/src/com/intellij/diff/comparison/ComparisonMergeUtil.kt)
- [JetBrains merge controls documentation](https://www.jetbrains.com/help/idea/differences-viewer.html)
- [VS Code custom editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)
