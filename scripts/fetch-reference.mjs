import { mkdir, writeFile } from 'node:fs/promises';
const revision = '4cc45ea6284376df26b1d290ea82fd55aae33cf7';
const files = [
  'platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt',
  'platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java',
  'platform/util/diff/src/com/intellij/diff/comparison/MergeResolveUtil.kt',
  'platform/util/diff/src/com/intellij/diff/comparison/ByWordRt.kt',
  'platform/util/diff/src/com/intellij/diff/comparison/ByCharRt.kt',
  'platform/util/diff/src/com/intellij/diff/comparison/TrimUtil.kt',
  'platform/util/diff/src/com/intellij/diff/comparison/ByLineRt.kt',
  'platform/util/diff/src/com/intellij/diff/comparison/ChangeCorrector.kt',
  'platform/util/diff/src/com/intellij/diff/comparison/ChunkOptimizer.kt',
  'platform/util/diff/src/com/intellij/diff/comparison/ComparisonMergeUtil.kt',
  'platform/util/diff/src/com/intellij/util/diff/Diff.kt',
  'platform/util/diff/src/com/intellij/util/diff/DiffConfig.kt',
  'platform/util/diff/src/com/intellij/util/diff/MyersLCS.kt',
  'platform/util/diff/src/com/intellij/util/diff/Reindexer.kt',
  'platform/diff-impl/tests/testSrc/com/intellij/diff/merge/MergeTest.kt',
  'platform/diff-impl/tests/testSrc/com/intellij/diff/comparison/MergeResolveUtilTest.kt',
];
await mkdir('.reference/intellij', { recursive: true });
for (const file of files) {
  const response = await fetch(`https://raw.githubusercontent.com/JetBrains/intellij-community/${revision}/${file}`);
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  await writeFile(`.reference/intellij/${file.split('/').at(-1)}`, await response.text());
}
console.log(`Downloaded ${files.length} IntelliJ reference files at ${revision}.`);
