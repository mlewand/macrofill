// A stand-in for Open Food Facts in e2e (no network in CI): it serves the responses recorded from
// the real API (apps/api/test/fixtures/openfoodfacts) for the barcodes below and a "not found"
// for any other. The app under test is pointed at it with OPEN_FOOD_FACTS_URL.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const fixtures = new URL('../../api/test/fixtures/openfoodfacts/', import.meta.url);
const known = {
  // The store's 13 digits: an EAN-13, and an EAN-8 as it is stored.
  3017620422003: 'nutella-ean13',
  '0000080177173': 'ean8-nutella',
};
const port = Number(process.env.OFF_STUB_PORT ?? 4174);

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub');
  if (url.pathname === '/ping') {
    res.end('ok');
    return;
  }
  const code = /^\/api\/v2\/product\/(\d+)$/.exec(url.pathname)?.[1];
  const name = code === undefined ? undefined : known[code];
  const status =
    name === undefined ? 404 : Number(readFileSync(new URL(`${name}.status`, fixtures)));
  const body =
    name === undefined
      ? JSON.stringify({ code, status: 0, status_verbose: 'product not found' })
      : readFileSync(new URL(`${name}.body`, fixtures), 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}).listen(port, '127.0.0.1');
