import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'src');
const forbiddenStrings = [
  'api.bybit.com',
  'api-testnet.bybit.com',
  'stream.bybit.com',
  'stream-testnet.bybit.com',
  'binance',
  'okx.com',
  'kucoin.com',
  'nobitex',
];

function isExcluded(relativePath: string): boolean {
  const segments = relativePath.split(path.sep);
  return segments.some((segment) => /^(?:docs?|tests?|__tests__)$/i.test(segment)) ||
    /\.(?:test|spec)\.[^.]+$/i.test(relativePath);
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    const relativePath = path.relative(repositoryRoot, fullPath);
    return entry.isFile() && !isExcluded(relativePath) ? [fullPath] : [];
  });
}

const files = collectSourceFiles(sourceRoot);
files.push(path.join(repositoryRoot, 'server.ts'));

const findings: string[] = [];
for (const file of files) {
  const relativePath = path.relative(repositoryRoot, file);
  const contents = readFileSync(file, 'utf8');
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, index) => {
    const matched = forbiddenStrings.filter((value) => line.toLowerCase().includes(value));
    for (const value of matched) {
      findings.push(`${relativePath}:${index + 1}: forbidden direct-exchange string "${value}"`);
    }
  });
}

if (findings.length > 0) {
  console.error('Direct-exchange references found:');
  findings.forEach((finding) => console.error(`  ${finding}`));
  assert.fail(`${findings.length} forbidden direct-exchange reference(s) found.`);
}

console.log('No direct-exchange references found in src and server.ts.');
