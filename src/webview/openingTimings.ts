import type { ToHost } from '../protocol';
import type { OpeningBrowserReport, OpeningMark, OpeningResource } from '../openingTimingProtocol';

declare global {
  interface Window {
    __mergeOpening?: { id: string; marks: OpeningMark[]; api: { postMessage(message: ToHost): void } };
  }
}
export function openingMark(label: string): void {
  const timing = window.__mergeOpening;
  if (timing && timing.marks.length < 40) timing.marks.push({ label, ms: performance.now() });
}
function resources(): OpeningResource[] {
  return performance.getEntriesByType('resource').filter(entry => /\.(js|css|woff2?|ttf)(?:\?|$)/.test(entry.name)).slice(0, 30).map(entry => {
    const resource = entry as PerformanceResourceTiming;
    return {
      name: new URL(resource.name).pathname.split('/').pop() ?? 'asset',
      start: resource.startTime, duration: resource.duration, responseEnd: resource.responseEnd,
      workerStart: resource.workerStart, transferSize: resource.transferSize,
      encodedBodySize: resource.encodedBodySize, decodedBodySize: resource.decodedBodySize,
    };
  });
}
export function reportOpening(phase: OpeningBrowserReport['phase'], id = window.__mergeOpening?.id, extraMarks?: OpeningMark[]): void {
  const timing = window.__mergeOpening;
  if (!timing || !id) return;
  timing.api.postMessage({ type: 'openingTiming', report: {
    id, phase, marks: extraMarks ?? [...timing.marks], resources: resources(), visibility: document.visibilityState,
  } });
}
export function reportOpeningFrame(id?: string): void {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    if (id) reportOpening('reveal', id, [{ label: 'Existing view frame', ms: performance.now() }]);
    else { openingMark('First merge frame (two animation frames)'); reportOpening('paint'); }
  }, 0)));
}
let observer: PerformanceObserver | undefined;
export function observeOpeningResources(): void {
  if (!window.__mergeOpening || observer) return;
  let updates = 0;
  observer = new PerformanceObserver(() => { if (updates++ < 15) reportOpening('resources'); });
  observer.observe({ type: 'resource', buffered: true });
  window.addEventListener('pagehide', () => observer?.disconnect(), { once: true });
}
