import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node main.ts [--input <snapshot.json|directory>] [--output <dir>] [--prepare-only]',
      '',
      '  --input <path>   snapshot.json or a directory holding it (default: /input)',
      '  --output <dir>   output directory (default: $MAKEFUN_OUTPUT_DIR or /output)',
      '  --prepare-only   write board.json, data.js and dashboard/ only; skip screenshots and dossier.json',
      '  -h, --help       show this help and exit',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const prepareOnly = process.argv.includes('--prepare-only');
const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
let shotCount = 0;
if (!prepareOnly) {
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  shotCount = shots.length;
  if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3 (board, detail, filtered)`);
  for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: invalid name`);
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
}

const top = board[0];
const dossierBytes = prepareOnly ? null : statSync(join(out, 'dossier.json')).size;
const summaryTail =
  (dossierBytes === null ? '' : `; dossier.json ${dossierBytes} bytes`) +
  (top === undefined ? '' : `; top: ${top.name} (implied ${top.implied_value_usd})`);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.counts.watchlist} watchlist + ${radar.counts.early} early = ${board.length} rows; ${radar.live_comp_count} live comps\n` +
    `token radar: wrote board.json, data.js, dashboard/${prepareOnly ? ' (prepare-only)' : `, screenshots/ (${shotCount}) and dossier.json`} to ${out}${summaryTail}\n`,
);
