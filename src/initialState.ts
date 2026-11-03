import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { EditorState } from './protocol';

const compress = promisify(gzip);
export interface PackedInitialState { base64: string; bytes: number; expandedBytes: number }

/** Base64 keeps arbitrary source text out of the HTML parser's script syntax. */
export async function packInitialState(state: EditorState): Promise<PackedInitialState> {
  const json = Buffer.from(JSON.stringify(state));
  const compressed = await compress(json);
  return { base64: compressed.toString('base64'), bytes: compressed.length, expandedBytes: json.length };
}
