import { monaco, installEditorEnvironment, language, theme } from './editor';
import { MergeSession, isResolved, type Command, type Hunk } from '../core/merge';
import { edits, lineAt } from '../core/diff';
import { wordEdits } from '../core/wordDiff';
import type { EditorState, ToHost, ToView } from '../protocol';
import { demoSamples } from './demoSamples';
import { BlameGutter } from './blameGutter';
import { DemoHistory } from './demoHistory';
import { observeOpeningResources, openingMark, reportOpeningFrame, takeInitialState } from './openingTimings';

declare function acquireVsCodeApi(): { postMessage(message: ToHost): void };
declare global {
  interface Window {
    mergerTest?: { session: MergeSession; send: (command: Command) => void; editors: monaco.editor.IStandaloneCodeEditor[] };
  }
}
const app = document.querySelector<HTMLDivElement>('#app')!;
installEditorEnvironment(app);

const icons = {
  prev: '<path d="m4 10 4-4 4 4"/>', next: '<path d="m4 6 4 4 4-4"/>',
  undo: '<path d="M5 4 2 7l3 3M2 7h7a4 4 0 0 1 4 4"/>', redo: '<path d="m11 4 3 3-3 3m3-3H7a4 4 0 0 0-4 4"/>',
  wand: '<path d="m4 13 7-7 2 2-7 7zm5-5 2 2M4 2v4M2 4h4m6-3v3m-1.5-1.5h3M13 12v3m-1.5-1.5h3"/>',
  all: '<path d="M1 8h4m-2-2 2 2-2 2m12-2h-4m2-2-2 2 2 2M7 2h2v12H7z"/>',
  left: '<path d="M1 8h8M6 5l3 3-3 3M12 2v12"/>', right: '<path d="M15 8H7m3-3L7 8l3 3M4 2v12"/>',
  sync: '<path d="M2 5h11m-3-3 3 3-3 3M14 11H3m3-3-3 3 3 3"/>',
  applyRight: '<path d="m1 2 6 6-6 6m7-12 6 6-6 6"/>',
  applyLeft: '<path d="m15 2-6 6 6 6M8 2 2 8l6 6"/>',
  ignore: '<path d="m2 2 12 12M14 2 2 14"/>',
  check: '<path d="m2 8 4 4 8-9"/>',
};
const icon = (name: keyof typeof icons): string => `<svg viewBox="0 0 16 16" data-icon="${name}" aria-hidden="true">${icons[name]}</svg>`;
const button = (id: string, label: string, name: keyof typeof icons): string => `<button id="${id}" class="tool" title="${label}" aria-label="${label}">${icon(name)}</button>`;

app.innerHTML = `
  <header class="toolbar" aria-label="Merge actions">
    <div class="tools">
      ${button('prev', 'Previous change (Shift+F7)', 'prev')}${button('next', 'Next change (F7)', 'next')}
      <select id="navigation" aria-label="Navigate through"><option value="unresolved">Unresolved changes</option><option value="conflicts">Unresolved conflicts</option><option value="all">All changes</option></select>
      <span class="separator"></span>
      <span class="apply-label">Apply non-conflicting changes:</span>
      <button id="apply-left" class="labeled" title="Apply Non-Conflicting Changes from the Left" aria-label="Apply Non-Conflicting Changes from the Left">${icon('left')}<span>Left</span></button>
      <button id="apply-all" class="labeled" title="Apply All Non-Conflicting Changes in this file" aria-label="Apply All Non-Conflicting Changes">${icon('all')}<span>All</span></button>
      <button id="apply-right" class="labeled" title="Apply Non-Conflicting Changes from the Right" aria-label="Apply Non-Conflicting Changes from the Right">${icon('right')}<span>Right</span></button>
      <span class="separator"></span>
      <button id="magic" class="tool" aria-label="Resolve Simple Conflicts" title="Resolve Simple Conflicts — combine independent word-level edits">${icon('wand')}</button>
    </div>
    <div class="tools secondary">
      ${button('undo', 'Undo', 'undo')}${button('redo', 'Redo', 'redo')}
      ${button('sync', 'Synchronize scrolling', 'sync')}
      <select id="compare" aria-label="Compare contents"><option value="">Compare contents…</option><option value="left,base">Local ↔ Base</option><option value="right,base">Incoming ↔ Base</option><option value="result,base">Result ↔ Base</option><option value="left,result">Local ↔ Result</option><option value="right,result">Incoming ↔ Result</option><option value="left,right">Local ↔ Incoming</option></select>
      <span id="status" role="status" aria-live="polite">Loading merge…</span>
    </div>
  </header>
  <div id="error" role="alert" hidden></div>
  <main class="merge-grid" aria-label="Three-way merge editor">
    <section class="pane" aria-label="Local version"><div class="pane-header"><strong>Local</strong><span id="left-label"></span></div><div id="left-editor" class="code"></div></section>
    <div id="left-gutter" class="divider" aria-label="Apply or ignore local changes"><svg aria-hidden="true"></svg><div class="controls"></div></div>
    <section class="pane result-pane" aria-label="Merge result"><div class="pane-header"><strong>Result</strong><span id="file-name"></span></div><div class="result-editor-shell"><div id="result-editor" class="code"></div><div id="result-actions" class="result-actions" aria-label="Resolve individual conflicts"></div></div></section>
    <div id="right-gutter" class="divider" aria-label="Apply or ignore incoming changes"><svg aria-hidden="true"></svg><div class="controls"></div></div>
    <section class="pane" aria-label="Incoming version"><div class="pane-header"><strong>Incoming</strong><span id="right-label"></span></div><div id="right-editor" class="code"></div></section>
  </main>
  <div class="change-bar" aria-label="Selected change">
    <span id="selected-label">Select a change</span><button id="mark-resolved">Mark Resolved</button><button id="reset">Revert Resolution</button>
    <span id="deletion-label" hidden>Result: delete file</span>
  </div>
  <footer><div class="tools"><button id="accept-left" title="Accept the entire local version">Accept Left</button><button id="accept-right" title="Accept the entire incoming version">Accept Right</button></div><div class="tools"><button id="save">Save</button><button id="complete" class="primary" title="Save and stage this resolved file" disabled>Apply Changes</button></div></footer>
`;

let host: { postMessage(message: ToHost): void };
let demo = false;
let state: EditorState;
let session: MergeSession;
let revision = 0;
let resync = false;
let selected: number | undefined;
let applying = false;
let sync = true;
let scrolling = false;
let renderFrame = 0;
const editors: monaco.editor.IStandaloneCodeEditor[] = [];
const blameGutters: BlameGutter[] = [];
const collections: monaco.editor.IEditorDecorationsCollection[] = [];
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const click = (id: string, action: () => void): void => { $(id).addEventListener('click', action); };
const disable = (id: string, value: boolean): void => { $<HTMLButtonElement>(id).disabled = value; };

function init(): void {
  theme();
  for (const [index, id] of ['left-editor', 'result-editor', 'right-editor'].entries()) {
    const content = index === 0 ? session.input.left : index === 1 ? session.result : session.input.right;
    const model = monaco.editor.createModel(content, state.input.language ?? language(state.input.name));
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    const editor = monaco.editor.create($(id), {
      model, readOnly: index !== 1, domReadOnly: index !== 1, automaticLayout: true,
      fontSize: state.fontSize, fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
      lineHeight: 21, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'off',
      folding: false, glyphMargin: index === 1, lineNumbersMinChars: 3, overviewRulerLanes: 2,
      renderLineHighlight: 'none', padding: { top: 10, bottom: 10 }, roundedSelection: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false },
      contextmenu: true, renderWhitespace: 'selection', fixedOverflowWidgets: true,
      accessibilitySupport: 'auto', ariaLabel: index === 1 ? 'Editable merge result' : index === 0 ? 'Read-only local version' : 'Read-only incoming version',
    });
    editors.push(editor); collections.push(editor.createDecorationsCollection());
    blameGutters.push(new BlameGutter(editor, (['left', 'result', 'right'] as const)[index], message => host.postMessage(message)));
    editor.onDidScrollChange(event => {
      if (sync && !scrolling && (event.scrollTopChanged || event.scrollLeftChanged)) {
        scrolling = true;
        const top = (event.scrollTop - 10) / 21 + 1;
        for (let j = 0; j < editors.length; j++) if (j !== index) editors[j].setScrollPosition({ scrollTop: (mapLine(top, index, j) - 1) * 21 + 10, scrollLeft: event.scrollLeft });
        scrolling = false;
      }
      scheduleGutters();
    });
    editor.onMouseDown(event => {
      const line = event.target.position?.lineNumber;
      if (line) {
        const h = session.hunks.find(h => {
          const range = index === 0 ? h.left : index === 1 ? h.result : h.right;
          return line >= lineAt(contentFor(index), range.start) && line <= lineAt(contentFor(index), range.end);
        });
        if (h) { selected = h.id; renderSelection(); scheduleGutters(); }
      }
    });
    editor.addCommand(monaco.KeyCode.F7, () => navigate(1));
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => navigate(-1));
    editor.addAction({ id: 'merger.markResolved', label: 'Mark Selected Change Resolved', contextMenuGroupId: 'merger', run: () => { if (selected !== undefined) send({ type: 'resolve', id: selected }); } });
    editor.addAction({ id: 'merger.reset', label: 'Revert Selected Resolution', contextMenuGroupId: 'merger', run: () => { if (selected !== undefined) send({ type: 'reset', id: selected }); } });
  }
  editors[1].onDidChangeModelContent(event => {
    if (!applying) send({ type: 'edit', edits: event.changes.map(change => ({ offset: change.rangeOffset, length: change.rangeLength, text: change.text })) });
  });
  // Route keyboard undo through the same history as arrows, ignore, and magic.
  for (const editor of editors) {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => host.postMessage({ type: 'undo' }));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => host.postMessage({ type: 'redo' }));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => host.postMessage({ type: 'redo' }));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => host.postMessage({ type: 'save' }));
  }
  new ResizeObserver(scheduleGutters).observe(document.querySelector('.merge-grid')!);
  void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
  selected = session.remaining[0]?.id ?? session.hunks[0]?.id;
  render();
  if (selected !== undefined) reveal(selected);
}
function contentFor(index: number): string { return index === 0 ? session.input.left : index === 1 ? session.result : session.input.right; }
function changeKind(h: Hunk): 'conflict' | 'added' | 'deleted' | 'modified' {
  if (h.conflict) return 'conflict';
  if (h.baseLines.start === h.baseLines.end) return 'added';
  if (h.leftChanged && h.leftLines.start === h.leftLines.end || h.rightChanged && h.rightLines.start === h.rightLines.end) return 'deleted';
  return 'modified';
}
function rangeFor(h: Hunk, index: number): { start: number; end: number } { return index === 0 ? h.left : index === 1 ? h.result : h.right; }
function mapLine(line: number, from: number, to: number): number {
  const anchors = [{ a: 1, b: 1 }];
  for (const h of session.hunks) {
    for (const key of ['start', 'end'] as const) anchors.push({ a: lineAt(contentFor(from), rangeFor(h, from)[key]), b: lineAt(contentFor(to), rangeFor(h, to)[key]) });
  }
  anchors.push({ a: editors[from].getModel()!.getLineCount(), b: editors[to].getModel()!.getLineCount() });
  anchors.sort((a, b) => a.a - b.a);
  let previous = anchors[0];
  for (const next of anchors.slice(1)) {
    if (line < next.a) return previous.b + (line - previous.a) * (next.b - previous.b) / Math.max(1, next.a - previous.a);
    previous = next;
  }
  return previous.b + line - previous.a;
}
function send(command: Command): void {
  try {
    if (!session.perform(command)) return;
    if (!demo) host.postMessage({ type: 'command', command, revision: revision++ });
    // Monaco can emit several incremental events for a single paste/IME input.
    // Wait until that batch finishes before reconciling the model or decorations.
    if (command.type === 'edit') queueMicrotask(render);
    else {
      const navigateAfter = command.type === 'bulk' || command.type === 'magic' && command.id === undefined;
      if (navigateAfter) selected = session.remaining[0]?.id ?? selected;
      render();
      if (navigateAfter && selected !== undefined) reveal(selected);
    }
  } catch (error) { showError(String(error)); }
}
function render(): void {
  if (!editors.length) return;
  for (const [index, value] of [[0, session.input.left], [2, session.input.right]] as const) {
    if (editors[index].getValue() !== value) editors[index].setValue(value);
  }
  const model = editors[1].getModel()!;
  if (model.getValue() !== session.result) {
    applying = true;
    const saved = editors[1].saveViewState();
    // Keep Monaco's model and cursor; global undo lives in the merge session.
    const changes = edits(model.getValue(), session.result);
    model.applyEdits(changes.map(edit => ({ range: monaco.Range.fromPositions(model.getPositionAt(edit.start), model.getPositionAt(edit.end)), text: edit.text })));
    if (saved) editors[1].restoreViewState(saved);
    applying = false;
  }
  $('file-name').textContent = session.input.name;
  $('left-label').textContent = session.input.leftLabel.replace(/^Local · /, '') + (session.input.leftDeleted ? ' · file deleted' : '');
  $('right-label').textContent = session.input.rightLabel.replace(/^Incoming · /, '') + (session.input.rightDeleted ? ' · file deleted' : '');
  $('status').textContent = `${session.remaining.length} unresolved change${session.remaining.length === 1 ? '' : 's'} · ${session.conflicts.length} conflict${session.conflicts.length === 1 ? '' : 's'}`;
  $('deletion-label').hidden = !session.deletion;
  $('sync').setAttribute('aria-pressed', String(sync));
  disable('complete', session.remaining.length > 0);
  disable('undo', !session.canUndo && !state.canUndo); disable('redo', !session.canRedo && !state.canRedo);
  for (const [id, side] of [['apply-left', 'left'], ['apply-right', 'right'], ['apply-all', undefined]] as const) {
    disable(id, !session.hunks.some(h => session.eligible(h) && !h.conflict && (!side || h[side === 'left' ? 'leftChanged' : 'rightChanged'])));
  }
  disable('magic', !session.hunks.some(h => session.eligible(h) && (!h.conflict || h.simple !== null)));
  for (let index = 0; index < editors.length; index++) {
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    const model = editors[index].getModel()!;
    for (const h of session.hunks) {
      if (index === 0 && !h.leftChanged || index === 2 && !h.rightChanged) continue;
      const range = rangeFor(h, index);
      const start = model.getPositionAt(range.start);
      const end = model.getPositionAt(range.end);
      const kind = changeKind(h);
      const last = range.end > range.start && end.column === 1 ? end.lineNumber - 1 : end.lineNumber;
      decorations.push({ range: new monaco.Range(start.lineNumber, 1, Math.max(start.lineNumber, last), 1), options: {
        isWholeLine: true, className: `change ${kind} ${isResolved(h) ? 'resolved' : ''} ${range.start === range.end ? 'empty-change' : ''}`,
        marginClassName: `change-margin ${kind} ${isResolved(h) ? 'resolved' : ''} ${range.start === range.end ? 'empty-change' : ''}`,
        linesDecorationsClassName: `change-stripe ${kind} ${isResolved(h) ? 'resolved' : ''}`,
        hoverMessage: { value: `Change ${h.id + 1}: ${isResolved(h) ? 'resolved' : h.manual ? 'manually edited' : h.conflict ? 'conflict' : 'non-conflicting change'}` },
      } });
      const current = contentFor(index).slice(range.start, range.end);
      for (const edit of wordEdits(h.baseText, current)) {
        if (!edit.text.length) continue;
        decorations.push({ range: monaco.Range.fromPositions(model.getPositionAt(range.start + edit.sideStart), model.getPositionAt(range.start + edit.sideEnd)), options: { inlineClassName: `word-change ${kind} ${isResolved(h) ? 'resolved' : ''}` } });
      }
    }
    collections[index].set(decorations);
  }
  renderSelection(); scheduleGutters();
  if (demo) window.mergerTest = { session, send, editors };
}
function renderSelection(): void {
  const h = session.hunks.find(h => h.id === selected);
  $('selected-label').textContent = h ? `Change ${h.id + 1} of ${session.hunks.length} · ${isResolved(h) ? 'Resolved' : h.manual ? 'Manually edited' : h.conflict ? 'Conflict' : 'Non-conflicting'}${h.simple !== null && !isResolved(h) ? ' · Can resolve automatically' : ''}` : 'No changes';
  disable('mark-resolved', !h || isResolved(h));
  disable('reset', !h || !(isResolved(h) || h.manual || h.resolved.left || h.resolved.right));
}
function showError(message: string): void { $('error').hidden = false; $('error').textContent = message; }
function scheduleGutters(): void { cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(drawGutters); }
function yAt(index: number, offset: number): number { return editors[index].getTopForLineNumber(lineAt(contentFor(index), offset)) - editors[index].getScrollTop(); }
function drawGutters(): void {
  if (!editors.length) return;
  const resultActions = $('result-actions');
  resultActions.replaceChildren();
  for (const h of session.hunks) {
    if (!h.conflict || h.simple === null || !session.eligible(h) || session.input.leftDeleted || session.input.rightDeleted) continue;
    const top = yAt(1, h.result.start);
    const bottom = yAt(1, h.result.end) + 21;
    if (bottom < 0 || top >= resultActions.clientHeight) continue;
    const wand = document.createElement('button');
    wand.className = 'conflict-wand'; wand.innerHTML = icon('wand');
    wand.title = `Resolve simple conflict ${h.id + 1}`;
    wand.setAttribute('aria-label', wand.title);
    wand.dataset.hunk = String(h.id); wand.dataset.action = 'magic';
    wand.style.top = `${Math.max(0, top)}px`;
    wand.addEventListener('click', () => { selected = h.id; send({ type: 'magic', id: h.id }); });
    resultActions.append(wand);
  }
  for (const [id, side, index] of [['left-gutter', 'left', 0], ['right-gutter', 'right', 2]] as const) {
    const gutter = $(id);
    const svg = gutter.querySelector('svg')!;
    const controls = gutter.querySelector('.controls')!;
    const width = gutter.clientWidth;
    const controlWidth = Number.parseFloat(getComputedStyle(gutter).getPropertyValue('--control-lane'));
    const height = gutter.clientHeight - 44;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = ''; controls.replaceChildren();
    for (const h of session.hunks) {
      const range = h[side];
      let sourceTop = yAt(index, range.start);
      let sourceBottom = range.start === range.end ? sourceTop + 21 : yAt(index, range.end) + (contentFor(index)[range.end - 1] === '\n' ? 0 : 21);
      let resultTop = yAt(1, h.result.start);
      let resultBottom = h.result.start === h.result.end ? resultTop + 2 : yAt(1, h.result.end) + (session.result[h.result.end - 1] === '\n' ? 0 : 21);
      if (Math.max(sourceBottom, resultBottom) < 0 || Math.min(sourceTop, resultTop) > height) continue;
      const a = side === 'left' ? sourceTop : resultTop;
      const b = side === 'left' ? sourceBottom : resultBottom;
      const c = side === 'left' ? resultTop : sourceTop;
      const d = side === 'left' ? resultBottom : sourceBottom;
      if (!h[side === 'left' ? 'leftChanged' : 'rightChanged']) continue;
      const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // Give each source-side action a flat, full-height section of the bubble.
      // Only the space AFTER the controls curves towards the result. For the
      // incoming side, mirror both the flat section and the action lane.
      const curveStart = side === 'left' ? controlWidth : 0;
      const curveEnd = side === 'left' ? width : width - controlWidth;
      const middle = (curveStart + curveEnd) / 2;
      shape.setAttribute('d', `M0 ${a} L${curveStart} ${a} C${middle} ${a},${middle} ${c},${curveEnd} ${c} L${width} ${c} L${width} ${d} L${curveEnd} ${d} C${middle} ${d},${middle} ${b},${curveStart} ${b} L0 ${b} Z`);
      shape.dataset.hunk = String(h.id);
      shape.setAttribute('class', `${changeKind(h)} ${isResolved(h) ? 'resolved' : ''} ${h.id === selected ? 'selected' : ''}`);
      shape.addEventListener('click', () => { selected = h.id; renderSelection(); scheduleGutters(); });
      svg.append(shape);
      if (!h[side === 'left' ? 'leftChanged' : 'rightChanged']) continue;
      const row = document.createElement('div'); row.className = 'change-controls';
      row.style.top = `${sourceTop}px`;
      if (h.resolved[side]) {
        row.classList.add('resolved-controls');
        const status = document.createElement('span');
        status.className = 'resolution-check'; status.innerHTML = icon('check'); status.title = `${side === 'left' ? 'Local' : 'Incoming'} side resolved`;
        const reset = document.createElement('button');
        reset.innerHTML = icon('undo');
        reset.title = `Revert resolution of change ${h.id + 1}`;
        reset.setAttribute('aria-label', `${reset.title} from ${side === 'left' ? 'local' : 'incoming'} side`);
        reset.dataset.hunk = String(h.id); reset.dataset.action = 'reset'; reset.dataset.side = side;
        reset.addEventListener('click', () => { selected = h.id; send({ type: 'reset', id: h.id }); });
        row.append(status, reset); controls.append(row); continue;
      }
      for (const type of side === 'left' ? ['ignore', 'apply'] as const : ['apply', 'ignore'] as const) {
        const btn = document.createElement('button');
        btn.innerHTML = icon(type === 'ignore' ? 'ignore' : side === 'left' ? 'applyRight' : 'applyLeft');
        const label = `${type === 'apply' ? 'Apply' : 'Ignore'} ${side === 'left' ? 'local' : 'incoming'} change ${h.id + 1}`;
        btn.title = `${label} (Ctrl/Cmd+click to resolve the whole conflict)`;
        btn.setAttribute('aria-label', label); btn.dataset.hunk = String(h.id); btn.dataset.action = type; btn.dataset.side = side;
        btn.addEventListener('click', event => { selected = h.id; send({ type, side, id: h.id, resolve: event.ctrlKey || event.metaKey }); });
        row.append(btn);
      }
      controls.append(row);
    }
  }
}
function reveal(id: number): void {
  const h = session.hunks.find(h => h.id === id);
  if (!h) return;
  scrolling = true;
  for (let i = 0; i < editors.length; i++) editors[i].revealLineInCenter(lineAt(contentFor(i), rangeFor(h, i).start));
  scrolling = false;
  renderSelection(); scheduleGutters();
}
function navigate(direction: number): void {
  if (!session) return;
  const mode = $<HTMLSelectElement>('navigation').value;
  const changes = mode === 'all' ? session.hunks : mode === 'conflicts' ? session.conflicts : session.remaining;
  if (!changes.length) return;
  const current = changes.findIndex(h => h.id === selected);
  selected = changes[(current + direction + changes.length) % changes.length].id;
  reveal(selected);
}
click('prev', () => navigate(-1)); click('next', () => navigate(1));
click('apply-all', () => send({ type: 'bulk' }));
click('apply-left', () => send({ type: 'bulk', side: 'left' })); click('apply-right', () => send({ type: 'bulk', side: 'right' }));
click('magic', () => send({ type: 'magic' }));
click('undo', () => host.postMessage({ type: 'undo' })); click('redo', () => host.postMessage({ type: 'redo' }));
click('save', () => host.postMessage({ type: 'save' })); click('complete', () => host.postMessage({ type: 'complete' }));
click('accept-left', () => send({ type: 'accept', side: 'left' })); click('accept-right', () => send({ type: 'accept', side: 'right' }));
click('mark-resolved', () => { if (selected !== undefined) send({ type: 'resolve', id: selected }); });
click('reset', () => { if (selected !== undefined) send({ type: 'reset', id: selected }); });
click('sync', () => { sync = !sync; $('sync').setAttribute('aria-pressed', String(sync)); });
$('compare').addEventListener('change', () => {
  const select = $<HTMLSelectElement>('compare');
  const [a, b] = select.value.split(',') as ['left', 'base'];
  if (a && b) host.postMessage({ type: 'compare', a, b }); select.value = '';
});
function receive(message: ToView): void {
  if (message.type === 'openingTimingRequest') { reportOpeningFrame(message.id); return; }
  if (message.type === 'blame' || message.type === 'blameError') { for (const gutter of blameGutters) gutter.receive(message); return; }
  if (message.type === 'error') { showError(message.message); resync = true; return; }
  if (message.type !== 'state' || (!resync && message.state.revision < revision)) return;
  const first = !session;
  if (first) openingMark('Initial state received');
  const hadError = resync;
  state = message.state; revision = state.revision; resync = false;
  if (first) openingMark('Browser merge model started');
  session = new MergeSession(state.input, state.snapshot);
  if (first) openingMark('Browser merge model finished');
  if (!hadError) $('error').hidden = true;
  if (first) {
    openingMark('Monaco editors creation started');
    init();
    openingMark('Monaco editors and decorations initialized');
    reportOpeningFrame();
  } else render();
}
if (typeof acquireVsCodeApi === 'function') {
  host = window.__mergeOpening?.api ?? acquireVsCodeApi();
  observeOpeningResources();
  window.addEventListener('message', event => receive(event.data as ToView));
  const initial = takeInitialState();
  openingMark('Application initialized; ready sent');
  host.postMessage({ type: 'ready', initialRevision: initial?.revision });
  if (initial) receive({ type: 'state', state: initial });
} else {
  demo = true;
  app.insertAdjacentHTML('afterbegin', '<div class="preview-bar" aria-label="Browser preview samples"><strong>Merge &amp; Blame</strong><label for="sample-select">Preview</label><select id="sample-select" aria-label="Preview sample"></select><button id="reset-sample">Reset sample</button><span id="sample-description"></span><a class="preview-source" href="https://github.com/SammyVimes/vscode-merge-and-blame" target="_blank" rel="noopener noreferrer">GitHub</a></div>');
  const sampleSelect = $<HTMLSelectElement>('sample-select');
  const demoHistory = new DemoHistory(() => session.input);
  for (const sample of demoSamples) {
    const option = document.createElement('option'); option.value = sample.id; option.textContent = sample.title;
    sampleSelect.append(option);
  }
  host = { postMessage(message) {
    if (message.type === 'blame' || message.type === 'openCommit') { demoHistory.handle(message, receive); return; }
    if (message.type === 'undo') session.undo();
    if (message.type === 'redo') session.redo();
    if (message.type === 'complete') $('sample-description').textContent = 'Sample resolved. Reset it or choose another example.';
    if (message.type === 'compare') showError('Version comparisons open in VS Code’s diff editor when running as an extension.');
    render();
  } };
  const loadSample = (id: string): void => {
    for (const gutter of blameGutters) gutter.hide();
    const sample = demoSamples.find(sample => sample.id === id) ?? demoSamples[0];
    sampleSelect.value = sample.id;
    $('sample-description').textContent = sample.description;
    session = new MergeSession(sample.input);
    state = { input: sample.input, snapshot: session.snapshot(), canUndo: false, canRedo: false, fontSize: 13, revision: 0 };
    revision = 0; selected = session.remaining[0]?.id;
    $('error').hidden = true;
    if (!editors.length) init();
    else {
      scrolling = true;
      render();
      for (const editor of editors) {
        editor.setPosition({ lineNumber: 1, column: 1 });
        editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
      }
      scrolling = false;
      scheduleGutters();
    }
    disable('save', true);
    $('save').title = 'Saving files is available when running this merger in VS Code.';
    const url = new URL(location.href);
    if (sample.id === 'overview') url.searchParams.delete('sample'); else url.searchParams.set('sample', sample.id);
    history.replaceState(null, '', url);
  };
  sampleSelect.addEventListener('change', () => loadSample(sampleSelect.value));
  click('reset-sample', () => loadSample(sampleSelect.value));
  loadSample(new URL(location.href).searchParams.get('sample') ?? 'overview');
}
