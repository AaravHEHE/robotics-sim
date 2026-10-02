// Zero-dependency static server for the prototype (serves the repo root).
// Usage: node prototype/compile-feasibility/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.argv[2] ?? 5173);
const types = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/octet-stream',
};

createServer(async (req, res) => {
  // Headless browsers POST their benchmark results here (?auto=<name> mode).
  if (req.method === 'POST' && req.url.startsWith('/report/')) {
    const name = req.url.slice('/report/'.length).replace(/[^\w-]/g, '');
    let body = '';
    for await (const chunk of req) body += chunk;
    await writeFile(path.join(root, `prototype/compile-feasibility/out/report-${name}.json`), body);
    console.log(`report from ${name} saved`);
    res.writeHead(204).end();
    return;
  }
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') {
      res.writeHead(302, { location: '/prototype/compile-feasibility/index.html' }).end();
      return;
    }
    const file = path.join(root, p);
    if (!file.startsWith(root)) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) throw new Error('dir');
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
