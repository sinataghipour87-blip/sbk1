import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseExchangeAddressFile } from '../src/services/exchangeAddressRegistry';

const CSV_FIELDS = [
  'chain',
  'address',
  'exchange',
  'label',
  'sourceName',
  'sourceUrl',
  'retrievedAt',
  'confidence',
  'note',
] as const;

function parseCsv(content: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length === 0 || rows[0].join(',') !== CSV_FIELDS.join(',')) {
    throw new Error(`CSV header must be exactly: ${CSV_FIELDS.join(',')}`);
  }
  return rows.slice(1).filter((values) => values.some((value) => value.length > 0)).map((values) => {
    if (values.length !== CSV_FIELDS.length) throw new Error('CSV row has the wrong number of columns.');
    return Object.fromEntries(CSV_FIELDS.map((name, index) => [name, values[index]]));
  });
}

async function main(): Promise<void> {
  const [inputArgument, outputArgument] = process.argv.slice(2);
  if (!inputArgument) {
    throw new Error('Usage: npm run import:exchange-addresses -- <input.csv|input.json> [output.json]');
  }
  const inputPath = path.resolve(inputArgument);
  const outputPath = path.resolve(outputArgument ?? 'data/exchange-addresses.json');
  const content = await readFile(inputPath, 'utf8');
  const raw: unknown = inputPath.toLowerCase().endsWith('.csv')
    ? { version: 1, addresses: parseCsv(content) }
    : JSON.parse(content);
  const registry = parseExchangeAddressFile(raw);
  await writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  console.info(`[ExchangeAddressImport] Wrote ${registry.addresses.length} unambiguous records to ${outputPath}.`);
}

main().catch((error: unknown) => {
  console.error('[ExchangeAddressImport] Import failed:', error);
  process.exitCode = 1;
});
