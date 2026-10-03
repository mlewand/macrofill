// Stand-ins for the product databases in e2e (no network in CI): Open Food Facts and USDA
// FoodData Central. They serve the responses recorded from the real APIs
// (apps/api/test/fixtures/openfoodfacts and .../usda) for the barcodes below, and "not found" for
// any other. The app under test is pointed at it with OPEN_FOOD_FACTS_URL and USDA_API_URL.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const fixtures = new URL('../../api/test/fixtures/', import.meta.url);
const read = (path) => readFileSync(new URL(path, fixtures), 'utf8');
const offKnown = {
  // The store's 13 digits: an EAN-13, and an EAN-8 as it is stored.
  3017620422003: 'nutella-ean13',
  '0000080177173': 'ean8-nutella',
};
// USDA is searched by the UPC-A's 12 digits.
const usdaKnown = { '016000275683': 'branded-hit' };
const port = Number(process.env.LOOKUP_STUB_PORT ?? 4174);

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub');
  if (url.pathname === '/ping') return res.end('ok');

  // Open Food Facts: GET /api/v2/product/<barcode>
  const code = /^\/api\/v2\/product\/(\d+)$/.exec(url.pathname)?.[1];
  if (code !== undefined) {
    const name = offKnown[code];
    if (name === undefined) {
      return send(
        res,
        404,
        JSON.stringify({ code, status: 0, status_verbose: 'product not found' }),
      );
    }
    return send(
      res,
      Number(read(`openfoodfacts/${name}.status`)),
      read(`openfoodfacts/${name}.body`),
    );
  }

  // USDA FoodData Central: GET /fdc/v1/foods/search?query=<gtin>&api_key=...
  if (url.pathname === '/fdc/v1/foods/search') {
    if (url.searchParams.get('api_key') !== 'e2e-usda-key') return send(res, 403, '{}');
    const name = usdaKnown[url.searchParams.get('query') ?? ''] ?? 'no-hits';
    return send(res, 200, read(`usda/${name}.body`));
  }
  send(res, 404, '{}');
}).listen(port, '127.0.0.1');
