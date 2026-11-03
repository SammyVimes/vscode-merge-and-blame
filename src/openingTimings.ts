import * as vscode from 'vscode';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { OpeningBrowserReport } from './openingTimingProtocol';
import { validBrowserReport } from './openingTimingProtocol';

export interface OperationTimer {
  measure<T>(label: string, operation: () => Promise<T>): Promise<T>;
}

interface HostMark { label: string; at: number; duration?: number }
export class OpeningTrace implements OperationTimer {
  readonly id = randomUUID();
  readonly started = new Date().toISOString();
  readonly marks: HostMark[] = [];
  readonly browser = new Map<OpeningBrowserReport['phase'], OpeningBrowserReport>();
  private readonly start = performance.now();
  result = 'in progress';
  constructor(readonly file: string, readonly source: string, private readonly log: (line: string) => void) {
    this.mark('Opening requested');
  }
  mark(label: string, duration?: number): void {
    if (this.marks.length >= 150) return;
    const at = performance.now() - this.start;
    this.marks.push({ label, at, duration });
    this.log(`[${this.id.slice(0, 8)}] +${at.toFixed(1)} ms ${label}${duration === undefined ? '' : ` (${duration.toFixed(1)} ms)`}`);
  }
  async measure<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await operation(); }
    finally { this.mark(label, performance.now() - start); }
  }
  sync<T>(label: string, operation: () => T): T {
    const start = performance.now();
    try { return operation(); }
    finally { this.mark(label, performance.now() - start); }
  }
  scope(prefix: string): OperationTimer {
    return { measure: (label, operation) => this.measure(`${prefix}: ${label}`, operation) };
  }
  finish(result: string): void { this.result = result; this.mark(result); }
  receive(report: OpeningBrowserReport): void {
    this.browser.set(report.phase, report);
    this.mark(`Browser report received: ${report.phase}`);
    if (report.phase === 'paint' || report.phase === 'reveal') this.finish('Merge frame reported');
    if (report.phase === 'error') this.result = 'browser error';
  }
  format(): string {
    const lines = [`Opening ${this.id.slice(0, 8)} | ${this.file} | ${this.source} | ${this.started}`, `Status: ${this.result}`,
      'Host timeline: milliseconds since our opening handler; durations in parentheses.'];
    for (const mark of this.marks) lines.push(`  +${mark.at.toFixed(1)} ms  ${mark.label}${mark.duration === undefined ? '' : ` (${mark.duration.toFixed(1)} ms)`}`);
    const latest = [...this.browser.values()];
    const marks = new Map<string, number>();
    const resources = new Map<string, NonNullable<OpeningBrowserReport['resources']>[number]>();
    for (const report of latest) {
      for (const mark of report.marks) marks.set(mark.label, mark.ms);
      for (const resource of report.resources ?? []) resources.set(resource.name, resource);
    }
    if (marks.size) {
      lines.push('Browser timeline: milliseconds since this webview navigation (a different clock).');
      for (const [label, ms] of [...marks].sort((a, b) => a[1] - b[1])) lines.push(`  +${ms.toFixed(1)} ms  ${label}`);
      lines.push(`  Visibility: ${latest.at(-1)?.visibility ?? 'unknown'}`);
    }
    if (resources.size) {
      lines.push('Browser resources: start / duration / response end / service-worker start; bytes = transfer / encoded / decoded.');
      for (const resource of resources.values()) lines.push(`  ${resource.name}: ${resource.start.toFixed(1)} / ${resource.duration.toFixed(1)} / ${resource.responseEnd.toFixed(1)} / ${resource.workerStart.toFixed(1)} ms; ${resource.transferSize} / ${resource.encodedBodySize} / ${resource.decodedBodySize} bytes`);
    }
    for (const report of latest) if (report.note) lines.push(`  ${report.phase}: ${report.note}`);
    return lines.join('\n');
  }
}

export class OpeningTimings implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Merge & Blame: Opening Timings');
  private readonly traces = new Map<string, OpeningTrace>();
  private readonly pending = new Map<string, OpeningTrace>();
  private readonly commands: vscode.Disposable[];
  private readonly header: string;
  constructor(version: string) {
    this.header = `Merge & Blame ${version} opening diagnostics\nVS Code ${vscode.version}; host ${process.platform}/${process.arch}; remote ${vscode.env.remoteName ?? 'local'}\nHost and browser clocks are separate: do not subtract their absolute offsets.\nThe native Git command's work BEFORE _open.mergeEditor hands over is not measured.\nA rendered frame is sampled after two animation frames; host completion also includes the return message over the connection.\nResource sizes may be zero/redacted for webview/service-worker URLs; zero does not prove a cache hit.\nOnly timings, asset names and file basenames are recorded; no file contents.\n`;
    this.output.appendLine(this.header);
    this.commands = [
      vscode.commands.registerCommand('_threeWayMerger.getOpeningTimings', () => this.report()),
      vscode.commands.registerCommand('threeWayMerger.showOpeningTimings', () => this.output.show(true)),
      vscode.commands.registerCommand('threeWayMerger.copyOpeningTimings', async () => {
        await vscode.env.clipboard.writeText(this.report());
        void vscode.window.showInformationMessage(`Copied ${this.traces.size} merge opening timing report(s).`);
      }),
    ];
  }
  begin(uri: vscode.Uri, source: string): OpeningTrace {
    const trace = new OpeningTrace(uri.path.split('/').pop() ?? 'file', source, line => this.output.appendLine(line));
    this.traces.set(trace.id, trace);
    if (this.traces.size > 20) this.traces.delete(this.traces.keys().next().value!);
    return trace;
  }
  prepare(uri: vscode.Uri, trace: OpeningTrace): void { this.pending.set(uri.toString(), trace); }
  take(uri: vscode.Uri): OpeningTrace {
    const trace = this.pending.get(uri.toString()); this.pending.delete(uri.toString());
    return trace ?? this.begin(uri, 'Open With / restored custom editor');
  }
  release(uri: vscode.Uri, trace: OpeningTrace): void {
    if (this.pending.get(uri.toString()) === trace) this.pending.delete(uri.toString());
  }
  receive(value: unknown): boolean {
    if (!validBrowserReport(value)) return false;
    const trace = this.traces.get(value.id);
    if (!trace) return false;
    trace.receive(value);
    if (value.phase === 'paint' || value.phase === 'reveal' || value.phase === 'error') this.output.appendLine(trace.format() + '\n');
    return true;
  }
  report(): string { return this.header + '\n' + [...this.traces.values()].map(trace => trace.format()).join('\n\n'); }
  dispose(): void { for (const command of this.commands) command.dispose(); this.output.dispose(); }
}
