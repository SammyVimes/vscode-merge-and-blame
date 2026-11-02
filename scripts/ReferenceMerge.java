// Test-only adapter to a locally installed JetBrains IDE. No IDE code is bundled.
import com.google.gson.*;
import com.intellij.diff.comparison.MergeResolveUtil;
import com.intellij.diff.comparison.ByLineRt;
import com.intellij.diff.comparison.ComparisonPolicy;
import com.intellij.diff.comparison.CancellationChecker;
import com.intellij.diff.comparison.ComparisonMergeUtil;
import com.intellij.diff.util.MergeRange;
import com.intellij.diff.util.Range;
import java.io.*;
import java.util.*;

class ReferenceMerge {
  public static void main(String[] args) throws Exception {
    JsonArray cases = JsonParser.parseReader(new InputStreamReader(System.in)).getAsJsonArray();
    JsonArray output = new JsonArray();
    for (JsonElement element : cases) {
      JsonObject item = element.getAsJsonObject();
      if (args.length > 0 && args[0].equals("lines")) {
        JsonArray ranges = new JsonArray();
        for (MergeRange range : ByLineRt.merge(Arrays.asList(item.get("left").getAsString().split("\n", -1)), Arrays.asList(item.get("base").getAsString().split("\n", -1)), Arrays.asList(item.get("right").getAsString().split("\n", -1)), ComparisonPolicy.DEFAULT, CancellationChecker.EMPTY)) {
          JsonArray row = new JsonArray();
          for (int value : new int[] { range.start2, range.end2, range.start1, range.end1, range.start3, range.end3 }) row.add(value);
          ranges.add(row);
        }
        output.add(ranges);
        continue;
      }
      if (args.length > 0 && args[0].equals("pairs")) {
        JsonArray ranges = new JsonArray();
        for (Range range : ByLineRt.compare(Arrays.asList(item.get("base").getAsString().split("\n", -1)), Arrays.asList(item.get("left").getAsString().split("\n", -1)), ComparisonPolicy.DEFAULT, CancellationChecker.EMPTY).iterateChanges()) {
          JsonArray row = new JsonArray();
          for (int value : new int[] { range.start1, range.end1, range.start2, range.end2 }) row.add(value);
          ranges.add(row);
        }
        output.add(ranges);
        continue;
      }
      CharSequence result = args.length > 0 && args[0].equals("greedy")
        ? MergeResolveUtil.tryGreedyResolve(item.get("left").getAsString(), item.get("base").getAsString(), item.get("right").getAsString())
        : ComparisonMergeUtil.tryResolveConflict(item.get("left").getAsString(), item.get("base").getAsString(), item.get("right").getAsString());
      output.add(result == null ? JsonNull.INSTANCE : new JsonPrimitive(result.toString()));
    }
    System.out.println(output);
  }
}
