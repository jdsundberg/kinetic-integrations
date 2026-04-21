#!/usr/bin/env node
// swagger2kinetic — generate a Kinetic connector JSON from an OpenAPI / Swagger spec.
//
// Usage:
//   swagger2kinetic --spec <url|path> --id <connector-id> [--out <path>] [options]
//
// Options:
//   --spec <u|p>           OpenAPI/Swagger JSON URL or local file path (required)
//   --id <slug>            Connector id, e.g. "freshdesk" (required)
//   --service <name>       Display name (defaults to spec.info.title)
//   --category <name>      e.g. "ITSM & Service Management" (default "Other")
//   --out <path>           Output connector JSON path (default: connectors/<id>.json)
//   --manifest <path>      Output manifest JSON path (default: <out>.manifest.json)
//   --include-tags a,b     Only operations with these tags
//   --exclude-tags a,b     Skip operations with these tags
//   --include-ops a,b      Only these operationIds
//   --exclude-ops a,b      Skip these operationIds
//   --max-routines N       Cap number of routines
//   --max-outputs N        Cap promoted scalar outputs per routine (default 5)
//   --docs-url <url>       Override documentation URL
//   --stdout               Print connector JSON to stdout instead of writing
//   --pretty               Pretty-print stdout (default when writing to file)
//   -h, --help             Show help
//
// Exits non-zero on error.

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";
import swaggerToConnector from "../lib/swagger-to-connector.mjs";

const HELP = `\
Usage: swagger2kinetic --spec <url|path> --id <slug> [options]

Required:
  --spec <url|path>    OpenAPI/Swagger JSON (URL or local file path)
  --id <slug>          Connector id, e.g. "freshdesk"

Optional:
  --service <name>     Display name (default: spec.info.title)
  --category <name>    Category label (default: "Other")
  --out <path>         Output path (default: connectors/<id>.json)
  --manifest <path>    Manifest path (default: <out>.manifest.json)
  --include-tags X,Y   Only operations with these tags
  --exclude-tags X,Y   Skip operations with these tags
  --include-ops X,Y    Only these operationIds
  --exclude-ops X,Y    Skip these operationIds
  --max-routines N     Cap total routines
  --max-outputs N      Cap promoted scalar outputs per routine (default 5)
  --docs-url <url>     Override external docs URL
  --stdout             Print to stdout instead of writing files
  --pretty             Pretty-print output
  -h, --help           Show this help
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { out.help = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      // Boolean flags
      if (["stdout", "pretty"].includes(key)) { out[key] = true; continue; }
      if (val === undefined || val.startsWith("--")) { out[key] = true; continue; }
      out[key] = val;
      i++;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function splitList(s) {
  if (!s || typeof s !== "string") return undefined;
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

// Fetch spec from URL (http/https) or local file.
async function loadSpec(src) {
  if (/^https?:\/\//i.test(src)) {
    return new Promise((resolve, reject) => {
      const mod = src.startsWith("https") ? https : http;
      mod.get(src, { headers: { Accept: "application/json" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow one redirect
          loadSpec(new URL(res.headers.location, src).toString()).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${src}`));
          return;
        }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(new Error(`Invalid JSON from ${src}: ${e.message}`)); }
        });
      }).on("error", reject);
    });
  }
  const absPath = path.resolve(src);
  if (!fs.existsSync(absPath)) throw new Error(`Spec file not found: ${absPath}`);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.spec || !args.id) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const spec = await loadSpec(args.spec);

  const opts = {
    id: args.id,
    service: args.service,
    category: args.category,
    docsUrl: args["docs-url"],
    includeTags: splitList(args["include-tags"]),
    excludeTags: splitList(args["exclude-tags"]),
    includeOps: splitList(args["include-ops"]),
    excludeOps: splitList(args["exclude-ops"]),
    maxRoutines: args["max-routines"] ? parseInt(args["max-routines"], 10) : undefined,
    maxOutputs: args["max-outputs"] ? parseInt(args["max-outputs"], 10) : undefined,
    sourceUrl: /^https?:/i.test(args.spec) ? args.spec : null,
  };

  const { connector, manifest, warnings } = swaggerToConnector(spec, opts);

  if (args.stdout) {
    process.stdout.write(JSON.stringify(connector, null, args.pretty ? 2 : 2) + "\n");
    if (warnings.length) {
      for (const w of warnings) process.stderr.write(`⚠︎ ${w}\n`);
    }
    return;
  }

  const outPath = args.out || `connectors/${args.id}.json`;
  const manifestPath = args.manifest || `${outPath}.manifest.json`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(connector, null, 2) + "\n");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const n = connector.routines.length;
  process.stdout.write(`✓ ${outPath} (${n} routines, auth=${connector.auth.type})\n`);
  process.stdout.write(`✓ ${manifestPath}\n`);
  if (warnings.length) {
    process.stdout.write(`\nWarnings:\n`);
    for (const w of warnings) process.stdout.write(`  - ${w}\n`);
  }
}

main().catch(e => {
  process.stderr.write(`✗ ${e.message}\n`);
  process.exit(1);
});
