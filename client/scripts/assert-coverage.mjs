import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} coverageDirectory Directory containing LCOV and HTML reports.
 */
export function assertCoverageReports(coverageDirectory) {
  const lcovPath = path.join(coverageDirectory, 'lcov.info');
  let lcov;

  try {
    lcov = readFileSync(lcovPath, 'utf8');
  } catch {
    throw new Error(
      `Coverage report is missing or unreadable: ${path.join('coverage', 'lcov.info')}`
    );
  }

  const records = [];
  let recordLines = [];

  for (const line of lcov.split(/\r?\n/)) {
    if (line === '') {
      continue;
    }

    if (line === 'end_of_record') {
      records.push(recordLines);
      recordLines = [];
      continue;
    }

    recordLines.push(line);
  }

  if (recordLines.length > 0) {
    throw new Error(
      `Malformed LCOV report: record is missing end_of_record in ${path.join('coverage', 'lcov.info')}`
    );
  }

  let sourceCount = 0;
  let lineCount = 0;
  let executedLineCount = 0;

  for (const record of records) {
    const sourceLines = record.filter((line) => line.startsWith('SF:'));
    if (sourceLines.length === 0) {
      throw new Error(
        `Coverage report must contain source and line records: ${path.join('coverage', 'lcov.info')}`
      );
    }
    if (sourceLines.length !== 1 || sourceLines[0].length === 3) {
      throw new Error(
        `Malformed LCOV report: each record needs one SF source in ${path.join('coverage', 'lcov.info')}`
      );
    }
    sourceCount += 1;

    for (const line of record) {
      if (line.startsWith('DA:')) {
        const match = /^DA:(\d+),(\d+)(?:,\d+)?$/.exec(line);
        if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(Number(match[2]))) {
          throw new Error(
            `Malformed LCOV line record "${line}" in ${path.join('coverage', 'lcov.info')}`
          );
        }

        lineCount += 1;
        if (Number(match[2]) > 0) {
          executedLineCount += 1;
        }
      } else if (!/^(?:TN:|SF:|FN:|FNDA:|FNF:|FNH:|BRDA:|BRF:|BRH:|LF:|LH:)/.test(line)) {
        throw new Error(`Malformed LCOV record "${line}" in ${path.join('coverage', 'lcov.info')}`);
      }
    }
  }

  if (sourceCount === 0 || lineCount === 0) {
    throw new Error(
      `Coverage report must contain source and line records: ${path.join('coverage', 'lcov.info')}`
    );
  }

  if (executedLineCount === 0) {
    throw new Error(`Coverage report has no executed lines: ${path.join('coverage', 'lcov.info')}`);
  }

  const htmlPath = path.join(coverageDirectory, 'index.html');
  try {
    if (!statSync(htmlPath).isFile() || readFileSync(htmlPath, 'utf8').trim().length === 0) {
      throw new Error('empty HTML report');
    }
  } catch {
    throw new Error(
      `Coverage HTML report is missing or unreadable: ${path.join('coverage', 'index.html')}`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertCoverageReports(path.join(process.cwd(), 'coverage'));
    console.log('Coverage reports are present and contain measured execution.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
