import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', '.cache']);
async function markdownFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') found.push(path);
  }
  return found;
}
const files = await markdownFiles(root);
const link = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const failures = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(link)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (
      !target ||
      target.startsWith('#') ||
      /^[a-z][a-z\d+.-]*:/i.test(target) ||
      target.startsWith('//')
    )
      continue;
    const path = target.split(/[?#]/, 1)[0];
    if (!path || path.startsWith('`')) continue;
    const destination = resolve(dirname(file), path);
    try {
      if (!(await stat(destination)).isFile()) failures.push(`${file}: ${target}`);
    } catch {
      failures.push(`${file}: ${target}`);
    }
  }
}
if (failures.length) {
  console.error(`Broken relative Markdown links (${failures.length}):\n${failures.join('\n')}`);
  process.exitCode = 1;
} else console.log(`Checked ${files.length} Markdown files; relative links are valid.`);
