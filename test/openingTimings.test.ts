import test from 'node:test';
import assert from 'node:assert/strict';
import { validBrowserReport } from '../src/openingTimingProtocol';

test('opening reports permit zero/redacted resource sizes and independent browser offsets', () => {
  assert.equal(validBrowserReport({ id: 'opening', phase: 'paint', marks: [{ label: 'frame', ms: 1250 }], visibility: 'visible', resources: [{
    name: 'webview.js', start: 3, duration: 1000, responseEnd: 1003, workerStart: 0,
    transferSize: 0, encodedBodySize: 0, decodedBodySize: 0,
  }] }), true);
});

test('malformed opening reports are ignored without throwing or retaining unbounded payloads', () => {
  for (const value of [null, {}, { id: 'x', phase: 'paint', marks: [null] },
    { id: 'x', phase: 'paint', marks: [{ label: 'invalid', ms: NaN }] },
    { id: 'x', phase: 'paint', marks: [], resources: [null] },
    { id: 'x', phase: 'paint', marks: Array(100).fill({ label: 'unbounded', ms: 1 }) }]) {
    assert.equal(validBrowserReport(value), false);
  }
});
