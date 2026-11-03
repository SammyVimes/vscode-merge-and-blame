export interface OpeningMark { label: string; ms: number }
export interface OpeningResource {
  name: string;
  start: number;
  duration: number;
  responseEnd: number;
  workerStart: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}
export interface OpeningBrowserReport {
  id: string;
  phase: 'bootstrap' | 'paint' | 'reveal' | 'resources' | 'worker' | 'error';
  marks: OpeningMark[];
  resources?: OpeningResource[];
  visibility?: string;
  note?: string;
}

export function validBrowserReport(value: unknown): value is OpeningBrowserReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as OpeningBrowserReport;
  return typeof report.id === 'string' && report.id.length < 100
    && ['bootstrap', 'paint', 'reveal', 'resources', 'worker', 'error'].includes(report.phase)
    && Array.isArray(report.marks) && report.marks.length <= 40
    && report.marks.every(mark => !!mark && typeof mark === 'object' && typeof mark.label === 'string' && mark.label.length < 150 && Number.isFinite(mark.ms) && mark.ms >= 0)
    && (report.visibility === undefined || ['visible', 'hidden', 'prerender'].includes(report.visibility))
    && (report.note === undefined || typeof report.note === 'string' && report.note.length < 500)
    && (report.resources === undefined || Array.isArray(report.resources) && report.resources.length <= 30
      && report.resources.every(resource => !!resource && typeof resource === 'object' && typeof resource.name === 'string' && resource.name.length < 200
        && ['start', 'duration', 'responseEnd', 'workerStart', 'transferSize', 'encodedBodySize', 'decodedBodySize']
          .every(key => Number.isFinite(resource[key as keyof OpeningResource]) && Number(resource[key as keyof OpeningResource]) >= 0)));
}
