import type { MergeInput } from '../core/merge';

interface Example {
  id: string;
  title: string;
  functionName: string;
  group: 'insertions' | 'deletions' | 'modifications' | 'conflicts';
  base: string[];
  left: string[];
  right: string[];
}

const examples: Example[] = [
  {
    id: 'local-insertion', title: 'Local adds new lines; incoming leaves this section unchanged', functionName: 'addLocalTracing', group: 'insertions',
    base: [],
    left: ['  result.traceId = request.id;', '  logger.debug("Local tracing enabled", context);'],
    right: [],
  },
  {
    id: 'incoming-insertion', title: 'Incoming adds new lines; local leaves this section unchanged', functionName: 'addIncomingAudit', group: 'insertions',
    base: [], left: [],
    right: ['  result.audit = createAuditEntry(context);', '  result.audit.source = "incoming";', '  auditQueue.push(result.audit);'],
  },
  {
    id: 'same-insertion', title: 'Both sides insert the same text: one non-conflicting addition', functionName: 'addSharedMetrics', group: 'insertions',
    base: [],
    left: ['  metrics.increment("requests.received");', '  result.measured = true;'],
    right: ['  metrics.increment("requests.received");', '  result.measured = true;'],
  },
  {
    id: 'inline-insertion', title: 'Local inserts text inside an existing line', functionName: 'addLocalTag', group: 'insertions',
    base: ['  result.tags = ["core"];'], left: ['  result.tags = ["core", "local"];'], right: ['  result.tags = ["core"];'],
  },
  {
    id: 'local-deletion', title: 'Local removes an entire block; incoming keeps the original', functionName: 'removeLocalLegacy', group: 'deletions',
    base: ['  result.legacy = true;', '  result.transport = "legacy-http";', '  logger.warn("Deprecated transport", context);'],
    left: [],
    right: ['  result.legacy = true;', '  result.transport = "legacy-http";', '  logger.warn("Deprecated transport", context);'],
  },
  {
    id: 'incoming-deletion', title: 'Incoming removes an entire block; local keeps the original', functionName: 'removeIncomingDebugging', group: 'deletions',
    base: ['  result.debug = dumpRequest(request);', '  logger.debug(result.debug, context);'],
    left: ['  result.debug = dumpRequest(request);', '  logger.debug(result.debug, context);'], right: [],
  },
  {
    id: 'same-deletion', title: 'Both sides delete the same block', functionName: 'removeSharedWorkaround', group: 'deletions',
    base: ['  result.workaround = "temporary";', '  applyWorkaround(result);'], left: [], right: [],
  },
  {
    id: 'local-modification', title: 'Only local changes an existing value', functionName: 'changeLocalRetries', group: 'modifications',
    base: ['  result.retries = 2;'], left: ['  result.retries = 5;'], right: ['  result.retries = 2;'],
  },
  {
    id: 'incoming-modification', title: 'Only incoming changes an existing value', functionName: 'changeIncomingTimeout', group: 'modifications',
    base: ['  result.timeout = 1000;'], left: ['  result.timeout = 1000;'], right: ['  result.timeout = 2500;'],
  },
  {
    id: 'same-modification', title: 'Both sides make the same replacement', functionName: 'changeSharedProtocol', group: 'modifications',
    base: ['  result.protocol = "http";'], left: ['  result.protocol = "https";'], right: ['  result.protocol = "https";'],
  },
  {
    id: 'word-conflict', title: 'Independent edits on the same line: try the inline magic wand', functionName: 'mergeLabelAndColor', group: 'conflicts',
    base: ['  result.label = format("old", "red");'],
    left: ['  result.label = format("new", "red");'],
    right: ['  result.label = format("old", "blue");'],
  },
  {
    id: 'neighboring-edits', title: 'Adjacent lines changed independently on different sides', functionName: 'mergeRegionAndLocale', group: 'conflicts',
    base: ['  result.region = "eu";', '  result.locale = "en";'],
    left: ['  result.region = "us";', '  result.locale = "en";'],
    right: ['  result.region = "eu";', '  result.locale = "fr";'],
  },
  {
    id: 'value-conflict', title: 'Competing replacements: choose a side or edit the result', functionName: 'chooseCachePolicy', group: 'conflicts',
    base: ['  result.cachePolicy = "default";'], left: ['  result.cachePolicy = "persistent";'], right: ['  result.cachePolicy = "ephemeral";'],
  },
  {
    id: 'insertion-conflict', title: 'Different insertions at the same position: their order needs a decision', functionName: 'chooseInsertedSteps', group: 'insertions',
    base: [], left: ['  result.steps.push("local-validation");', '  validateLocalRequest(request);'],
    right: ['  result.steps.push("incoming-validation");', '  validateIncomingRequest(request);'],
  },
  {
    id: 'delete-edit-conflict', title: 'Local deletes a block that incoming edits', functionName: 'reviewMigration', group: 'conflicts',
    base: ['  result.migration = "legacy";', '  migrateLegacyData(result);'], left: [],
    right: ['  result.migration = "v2";', '  migrateCurrentData(result);'],
  },
  {
    id: 'unequal-blocks', title: 'Unequal replacement lengths: compare the connecting shapes and scrolling', functionName: 'chooseProcessingPipeline', group: 'conflicts',
    base: ['  result.pipeline = "default";', '  processDefault(result);'],
    left: ['  result.pipeline = "batch";', '  const chunks = splitIntoChunks(request);', '  for (const chunk of chunks) {', '    processBatch(chunk, result);', '  }'],
    right: ['  result.pipeline = "stream";', '  processStream(request, result);', '  result.streaming = true;'],
  },
  {
    id: 'whitespace', title: 'Whitespace-only change', functionName: 'reviewWhitespace', group: 'modifications',
    base: ['  result.normalized = normalize(request);'], left: ['    result.normalized = normalize(request);'], right: ['  result.normalized = normalize(request);'],
  },
];

export interface DemoSample {
  id: string;
  title: string;
  description: string;
  input: MergeInput;
}

function input(name: string, base: string, left: string, right: string): MergeInput {
  return { name, base, left, right, leftLabel: 'Local · feature (ours)', rightLabel: 'Incoming · main (theirs)' };
}

function sample(id: string, title: string, description: string, chosen: Example[]): DemoSample {
  const text = (side: 'base' | 'left' | 'right'): string => [
    '// Merge preview: each section demonstrates a different kind of change.',
    'import { prepare, report, logger, metrics } from "./services";',
    '',
    ...chosen.flatMap(example => [
      `// ${example.title}`,
      `export function ${example.functionName}(request: Request) {`,
      `  const result = prepare("${example.functionName}", request);`,
      '  const context = { requestId: request.id };',
      '',
      ...example[side],
      '',
      `  report("${example.functionName}", result, context);`,
      '  return result;',
      '}',
      '',
    ]),
    '// End of sample.',
    '',
  ].join('\n');
  return { id, title, description, input: input(`${id}.ts`, text('base'), text('left'), text('right')) };
}

const legacy = '\n// Legacy compatibility\nexport const legacy = true;\n\n// Additional settings\n';
const quick = input('settings.ts',
  'export const config = {\n  name: "old",\n  retries: 2,\n  timeout: 1000,\n};\n\nrender(oldName, oldColor);\n\nexport const enabled = false;\n\nexport const attempts = 1;\n' + legacy,
  'export const config = {\n  name: "local",\n  retries: 2,\n  timeout: 1000,\n};\n\nrender(newName, oldColor);\n\nexport const enabled = true;\n\nexport const attempts = 1;\n' + legacy + 'export const cache = true;\n',
  'export const config = {\n  name: "incoming",\n  retries: 5,\n  timeout: 1000,\n};\n\nrender(oldName, newColor);\n\nexport const enabled = false;\n\nexport const attempts = 2;\n' + legacy.replace('export const legacy = true;\n', ''),
);
const boundaryBase = 'export const mode = "base";\n\nexport function run() {\n  return mode;\n}';

export const demoSamples: DemoSample[] = [
  sample('overview', 'Full example · 17 cases', 'Additions, deletions, replacements, whitespace and conflicts. Scroll or use F7 to visit each change.', examples),
  sample('insertions', 'Insertions', 'New blocks from either side, an insertion inside a line, and competing insertions at the same position.', examples.filter(e => e.group === 'insertions')),
  sample('deletions', 'Deletions', 'Entire blocks removed by local, incoming, or both sides.', examples.filter(e => e.group === 'deletions')),
  sample('modifications', 'Replacements and whitespace', 'Existing lines changed on one side or identically on both sides.', examples.filter(e => e.group === 'modifications')),
  sample('conflicts', 'Conflicts and magic wand', 'Resolvable word edits, competing values, delete/edit conflicts, and unequal block lengths.', examples.filter(e => e.group === 'conflicts')),
  { id: 'boundaries', title: 'Beginning and end of file', description: 'A new first line and an append after a file that originally had no final newline.', input: input('boundaries.ts', boundaryBase, '// Local adds the first line.\n' + boundaryBase, boundaryBase + '\n\n// Incoming appends after the old EOF.\nexport const version = 2;\n') },
  { id: 'quick', title: 'Quick example', description: 'A compact example with a few common changes.', input: quick },
];
