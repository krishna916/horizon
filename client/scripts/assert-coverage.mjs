import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LCOV_REPORT = path.join('coverage', 'lcov.info');
const HTML_REPORT = path.join('coverage', 'index.html');
const ALLOWED_LCOV_RECORD = /^(?:TN:|SF:|FN:|FNDA:|FNF:|FNH:|BRDA:|BRF:|BRH:|LF:|LH:)/;

function readLcovReport(coverageDirectory) {
  const lcovPath = path.join(coverageDirectory, 'lcov.info');

  try {
    return readFileSync(lcovPath, 'utf8');
  } catch {
    throw new Error(`Coverage report is missing or unreadable: ${LCOV_REPORT}`);
  }
}

function parseLcovRecords(lcov) {
  const records = [];
  let recordLines = [];

  for (const line of lcov.split(/\r?\n/)) {
    if (line === '') continue;
    if (line === 'end_of_record') {
      records.push(recordLines);
      recordLines = [];
    } else {
      recordLines.push(line);
    }
  }

  if (recordLines.length > 0) {
    throw new Error(`Malformed LCOV report: record is missing end_of_record in ${LCOV_REPORT}`);
  }

  return records;
}

function validateSourceRecord(record) {
  const sourceLines = record.filter((line) => line.startsWith('SF:'));

  if (sourceLines.length === 0) {
    throw new Error(`Coverage report must contain source and line records: ${LCOV_REPORT}`);
  }
  if (sourceLines.length !== 1 || sourceLines[0].length === 3) {
    throw new Error(`Malformed LCOV report: each record needs one SF source in ${LCOV_REPORT}`);
  }
}

function validateLineRecord(line) {
  const match = /^DA:(\d+),(\d+)(?:,\d+)?$/.exec(line);
  if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error(`Malformed LCOV line record "${line}" in ${LCOV_REPORT}`);
  }

  return Number(match[2]) > 0;
}

function countRecordLines(record) {
  let lineCount = 0;
  let executedLineCount = 0;

  for (const line of record) {
    if (line.startsWith('DA:')) {
      lineCount += 1;
      if (validateLineRecord(line)) executedLineCount += 1;
    } else if (!ALLOWED_LCOV_RECORD.test(line)) {
      throw new Error(`Malformed LCOV record "${line}" in ${LCOV_REPORT}`);
    }
  }

  return { lineCount, executedLineCount };
}

function validateLcovReport(lcov) {
  const records = parseLcovRecords(lcov);
  let sourceCount = 0;
  let lineCount = 0;
  let executedLineCount = 0;

  for (const record of records) {
    validateSourceRecord(record);
    sourceCount += 1;

    const counts = countRecordLines(record);
    lineCount += counts.lineCount;
    executedLineCount += counts.executedLineCount;
  }

  if (sourceCount === 0 || lineCount === 0) {
    throw new Error(`Coverage report must contain source and line records: ${LCOV_REPORT}`);
  }
  if (executedLineCount === 0) {
    throw new Error(`Coverage report has no executed lines: ${LCOV_REPORT}`);
  }
}

function validateHtmlReport(coverageDirectory) {
  const htmlPath = path.join(coverageDirectory, 'index.html');

  try {
    if (!statSync(htmlPath).isFile() || readFileSync(htmlPath, 'utf8').trim().length === 0) {
      throw new Error('empty HTML report');
    }
  } catch {
    throw new Error(`Coverage HTML report is missing or unreadable: ${HTML_REPORT}`);
  }
}

/**
 * @param {string} coverageDirectory Directory containing LCOV and HTML reports.
 */
export function assertCoverageReports(coverageDirectory) {
  validateLcovReport(readLcovReport(coverageDirectory));
  validateHtmlReport(coverageDirectory);
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
