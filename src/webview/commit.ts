import { installEditorEnvironment, theme } from './editor';
import { CommitView } from './commitView';
import type { CommitRequest, CommitResponse } from '../historyProtocol';

declare function acquireVsCodeApi(): { postMessage(message: CommitRequest): void };
const root = document.querySelector<HTMLElement>('#app')!;
installEditorEnvironment(root); theme();
const host = acquireVsCodeApi();
const view = new CommitView(root, index => host.postMessage({ type: 'selectFile', index }), () => host.postMessage({ type: 'close' }));
window.addEventListener('message', event => {
  const message = event.data as CommitResponse;
  if (message.type === 'commit') view.update(message.state);
  if (message.type === 'error') view.error(message.message);
});
host.postMessage({ type: 'ready' });
