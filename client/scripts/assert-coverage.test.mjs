import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { assertCoverageReports } from './assert-coverage.mjs';

const temporaryDirectories = [];

function createCoverageDirectory({ lcov, includeHtml = true } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'horizon-coverage-'));
  temporaryDirectories.push(directory);

  if (lcov !== undefined) {
    writeFileSync(path.join(directory, 'lcov.info'), lcov);
  }

  if (includeHtml) {
    writeFileSync(path.join(directory, 'index.html'), '<html>coverage</html>');
  }

  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts source and line records with measured execution and readable HTML', () => {
  const directory = createCoverageDirectory({
    lcov: [
      'TN:',
      'SF:src/covered.ts',
      'FN:1,covered',
      'FNDA:1,covered',
      'FNF:1',
      'FNH:1',
      'DA:1,1',
      'DA:2,0',
      'LF:2',
      'LH:1',
      'end_of_record',
      '',
    ].join('\n'),
  });

  assert.doesNotThrow(() => assertCoverageReports(directory));
});

test('reports the expected path when LCOV is missing', () => {
  const directory = createCoverageDirectory();

  assert.throws(() => assertCoverageReports(directory), /coverage\/lcov\.info/);
});

test('rejects malformed or incomplete LCOV records', () => {
  const directory = createCoverageDirectory({ lcov: 'SF:src/covered.ts\nDA:1,1\n' });

  assert.throws(() => assertCoverageReports(directory), /end_of_record/);
});

test('rejects LCOV without source and line data', () => {
  const directory = createCoverageDirectory({ lcov: 'TN:\nend_of_record\n' });

  assert.throws(() => assertCoverageReports(directory), /source and line records/);
});

test('rejects malformed LCOV line records', () => {
  const directory = createCoverageDirectory({
    lcov: 'SF:src/covered.ts\nDA:1,not-a-hit-count\nend_of_record\n',
  });

  assert.throws(() => assertCoverageReports(directory), /Malformed LCOV line record/);
});

test('rejects reports when no production line has a positive hit count', () => {
  const directory = createCoverageDirectory({
    lcov: 'SF:src/untested.ts\nDA:1,0\nLF:1\nLH:0\nend_of_record\n',
  });

  assert.throws(() => assertCoverageReports(directory), /no executed lines/);
});

test('reports the expected path when the HTML index is missing', () => {
  const directory = createCoverageDirectory({
    lcov: 'SF:src/covered.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n',
    includeHtml: false,
  });

  assert.throws(() => assertCoverageReports(directory), /coverage\/index\.html/);
});
