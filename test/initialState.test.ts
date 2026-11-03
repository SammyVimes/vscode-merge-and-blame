import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { packInitialState } from '../src/initialState';
import { MergeSession } from '../src/core/merge';
import type { EditorState } from '../src/protocol';

test('initial HTML state preserves arbitrary code while keeping script terminators out of HTML', async () => {
  const code = '</script><script>globalThis.injected=true</script>\n中文 é 😀\n';
  const session = new MergeSession({ base: code, left: code + 'local\n', right: code + 'incoming\n', name: 'test.html', leftLabel: 'Local', rightLabel: 'Incoming' });
  session.perform({ type: 'apply', id: session.hunks[0].id, side: 'left' });
  const state: EditorState = { input: session.input, snapshot: session.snapshot(), canUndo: true, canRedo: false, fontSize: 13, revision: 7 };
  const packed = await packInitialState(state);
  assert.match(packed.base64, /^[A-Za-z0-9+/]+=*$/);
  const compressed = Buffer.from(packed.base64, 'base64');
  const json = gunzipSync(compressed);
  assert.equal(compressed.length, packed.bytes);
  assert.equal(json.length, packed.expandedBytes);
  assert.deepEqual(JSON.parse(json.toString()), state);
});
