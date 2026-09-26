import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const runtimeDir = path.join(root, '.runtime');
const contentDir = path.join(root, 'content');
const distDir = path.join(root, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, 'data'), { recursive: true });
await cp(publicDir, distDir, { recursive: true });

const files = [
  [path.join(runtimeDir, 'current.json'), path.join(distDir, 'data', 'current.json')],
  [path.join(dataDir, 'incidents.json'), path.join(distDir, 'data', 'incidents.json')],
  [path.join(dataDir, 'uptime.json'), path.join(distDir, 'data', 'uptime.json')],
  [path.join(contentDir, 'maintenance.json'), path.join(distDir, 'data', 'maintenance.json')],
  [path.join(contentDir, 'manual-incidents.json'), path.join(distDir, 'data', 'manual-incidents.json')],
];

for (const [source, destination] of files) {
  await cp(source, destination);
}

const current = JSON.parse(await readFile(path.join(runtimeDir, 'current.json'), 'utf8'));
await writeFile(
  path.join(distDir, 'data', 'summary.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    status: current.status,
    generatedAt: current.generatedAt,
    components: current.components.map(({ id, name, status }) => ({ id, name, status })),
  }, null, 2)}\n`,
  'utf8'
);

await writeFile(path.join(distDir, '.nojekyll'), '', 'utf8');
process.stdout.write(`Built independent status site at ${distDir}\n`);
