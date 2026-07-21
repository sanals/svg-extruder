/**
 * Regression check for exported 3MF fixture files.
 * Pass criteria: 0 open edges, 0 non-manifold edges per mesh object.
 *
 * Usage: npm run validate-3mf-fixtures
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const FIXTURES = [
  'extruded_model (94).3mf',
  'extruded_model (99).3mf',
  'extruded_model - 2026-07-21T090130.410.3mf',
];

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function analyzeMesh(verts, tris) {
  const edges = new Map();
  let degenerate = 0;
  for (const [a, b, c] of tris) {
    if (a === b || b === c || a === c) {
      degenerate += 1;
      continue;
    }
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(x, y);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  let nm = 0;
  for (const count of edges.values()) {
    if (count === 1) open += 1;
    else if (count > 2) nm += 1;
  }
  return { open, nm, degenerate, tris: tris.length, verts: verts.length };
}

function parse3mf(filePath) {
  // Lazy-load jszip from project deps
  const JSZip = require('jszip');
  const buf = fs.readFileSync(filePath);
  return JSZip.loadAsync(buf).then(async (zip) => {
    const xml = await zip.file('3D/3dmodel.model').async('string');
    const results = [];
    const parts = xml.split(/<object\b/).slice(1);
    for (const chunk of parts) {
      const idMatch = chunk.match(/\bid="(\d+)"/);
      const oid = idMatch ? idMatch[1] : '?';
      const meshMatch = chunk.match(/<mesh>([\s\S]*?)<\/mesh>/);
      if (!meshMatch) continue;
      const mesh = meshMatch[1];
      const verts = [...mesh.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((m) => [
        parseFloat(m[1]),
        parseFloat(m[2]),
        parseFloat(m[3]),
      ]);
      const tris = [...mesh.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => [
        parseInt(m[1], 10),
        parseInt(m[2], 10),
        parseInt(m[3], 10),
      ]);
      if (tris.length === 0) continue;
      results.push({ oid, ...analyzeMesh(verts, tris) });
    }
    return results;
  });
}

async function main() {
  let failed = false;
  console.log('3MF fixture topology regression\n');

  for (const name of FIXTURES) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) {
      console.log(`SKIP ${name} (file not found)`);
      continue;
    }

    const objects = await parse3mf(filePath);
    const totals = objects.reduce(
      (acc, o) => ({
        open: acc.open + o.open,
        nm: acc.nm + o.nm,
        deg: acc.deg + o.degenerate,
        tris: acc.tris + o.tris,
      }),
      { open: 0, nm: 0, deg: 0, tris: 0 },
    );

    const pass = totals.open === 0 && totals.nm === 0;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
    console.log(`  objects=${objects.length} tris=${totals.tris} open=${totals.open} nm=${totals.nm} deg=${totals.deg}`);
    if (!pass) {
      failed = true;
      for (const o of objects.filter((x) => x.open > 0 || x.nm > 0)) {
        console.log(`  obj ${o.oid}: open=${o.open} nm=${o.nm} deg=${o.degenerate}`);
      }
    }
    console.log('');
  }

  if (failed) {
    console.error('Some fixtures failed topology checks.');
    process.exit(1);
  }
  console.log('All present fixtures passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
