#!/usr/bin/env node
// webhook-push — replay a webhook payload into a Kinetic WebAPI URL.
//
// Auto-configures the signature by reading _meta.json from the same directory
// as the payload file. Works as a local-dev harness for building webhook
// receivers — you drop a payload file, point at your receiver URL, and the
// tool POSTs with the correct signature header.
//
// Usage:
//   webhook-push --to <url> --payload <file|-> [options]
//
// Options:
//   --to <url>          Kinetic WebAPI URL (required)
//   --payload <file|->  Path to JSON payload, or - for stdin (required)
//   --meta <file>       Override _meta.json path (default: ./<payload-dir>/_meta.json)
//   --secret <s>        Shared secret for signing (required if meta declares signing)
//   --basic <user:pw>   Add HTTP Basic authorization
//   --header <k=v>      Add a custom header (repeatable)
//   --method <METHOD>   HTTP method (default POST)
//   --content-type <t>  Override Content-Type (default: from meta or application/json)
//   --dry-run           Print the request that would be sent; don't actually POST
//   --verbose           Print headers + response in detail
//   -h, --help          Show help
//
// Exit codes: 0 on 2xx, 1 on request error, 2 on non-2xx HTTP response.

import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import crypto from "crypto";

const HELP = `\
Usage: webhook-push --to <url> --payload <file|-> [options]

Required:
  --to <url>          Target webhook-receiver URL
  --payload <file|->  JSON payload (file path, or - for stdin)

Optional:
  --meta <file>       Explicit _meta.json (default: sibling of --payload)
  --secret <s>        Shared secret for HMAC/MD5 signing
  --basic <user:pw>   HTTP Basic auth
  --header <k=v>      Extra header (repeatable)
  --method <m>        HTTP method (default POST)
  --content-type <t>  Override Content-Type
  --dry-run           Show what would be sent; no network call
  --verbose           Detailed request/response output
  -h, --help          Show this help
`;

function parseArgs(argv) {
  const out = { _: [], header: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { out.help = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["dry-run", "verbose"].includes(key)) { out[key] = true; continue; }
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) { out[key] = true; continue; }
      if (key === "header") { out.header.push(val); i++; continue; }
      out[key] = val;
      i++;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", c => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString()));
    process.stdin.on("error", reject);
  });
}

async function loadPayload(src) {
  if (src === "-") return await readStdin();
  return fs.readFileSync(path.resolve(src), "utf8");
}

function tryLoadMeta(metaArg, payloadPath) {
  const candidates = [];
  if (metaArg) candidates.push(metaArg);
  if (payloadPath && payloadPath !== "-") {
    candidates.push(path.join(path.dirname(payloadPath), "_meta.json"));
  }
  for (const c of candidates) {
    try {
      const body = fs.readFileSync(c, "utf8");
      return JSON.parse(body);
    } catch { /* try next */ }
  }
  return null;
}

// Compute signature per the algo+encoding declared in meta.signing.
// Returns { headerName, headerValue } or null if no signing configured.
function computeSignature(meta, secret, rawBody) {
  const sig = meta?.signing;
  if (!sig || !sig.header) return null;
  if (!secret) {
    throw new Error(`Payload meta declares signing via header "${sig.header}" (algo=${sig.algorithm}) but no --secret was provided.`);
  }
  const algo = (sig.algorithm || "").toLowerCase().replace(/-/g, "");
  const encoding = (sig.encoding || inferEncoding(sig.format)).toLowerCase();

  let mac;
  if (algo.includes("hmacsha256") || algo === "sha256") mac = crypto.createHmac("sha256", secret).update(rawBody).digest(encoding);
  else if (algo.includes("hmacsha1") || algo === "sha1") mac = crypto.createHmac("sha1", secret).update(rawBody).digest(encoding);
  else if (algo.includes("hmacmd5") || algo === "md5") mac = crypto.createHmac("md5", secret).update(rawBody).digest(encoding);
  else throw new Error(`Unsupported signing algorithm: ${sig.algorithm}`);

  let headerValue = mac;
  if (sig.headerPrefix) headerValue = sig.headerPrefix + mac;
  return { headerName: sig.header, headerValue };
}

// meta.signing.format sometimes says "base64(...)" or "hex(...)"; infer if
// encoding field absent.
function inferEncoding(format) {
  if (!format) return "hex";
  const f = format.toLowerCase();
  if (f.includes("base64")) return "base64";
  if (f.includes("hex")) return "hex";
  return "hex";
}

function parseHeaderKV(list) {
  const out = {};
  for (const h of list || []) {
    const i = h.indexOf("=");
    if (i < 0) throw new Error(`Invalid --header (need k=v): ${h}`);
    out[h.slice(0, i).trim()] = h.slice(i + 1).trim();
  }
  return out;
}

function postRequest(url, headers, body, method = "POST") {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.to || !args.payload) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const raw = (await loadPayload(args.payload)).trim();
  // Normalize whitespace-insensitive — always re-serialize canonically.
  // BUT: signatures are computed over the bytes actually sent, so we serialize
  // once, then compute on that.
  let rawBody;
  try {
    rawBody = JSON.stringify(JSON.parse(raw));
  } catch {
    throw new Error(`Payload is not valid JSON`);
  }

  const meta = tryLoadMeta(args.meta, args.payload === "-" ? null : args.payload);

  const headers = {
    "Content-Type": args["content-type"] || meta?.transport?.contentType || "application/json",
    "Accept": "application/json",
    "User-Agent": "kinetic-webhook-push/0.1",
  };

  const sigEntry = meta ? computeSignature(meta, args.secret, rawBody) : null;
  if (sigEntry) headers[sigEntry.headerName] = sigEntry.headerValue;

  // Custom headers from --header flags override anything above
  Object.assign(headers, parseHeaderKV(args.header));

  // Basic auth
  if (args.basic) {
    const encoded = Buffer.from(args.basic).toString("base64");
    headers["Authorization"] = "Basic " + encoded;
  }

  const method = (args.method || meta?.transport?.method || "POST").toUpperCase();

  if (args["dry-run"] || args.verbose) {
    process.stdout.write(`→ ${method} ${args.to}\n`);
    for (const [k, v] of Object.entries(headers)) {
      const shown = k.toLowerCase() === "authorization" ? v.slice(0, 15) + "…" : v;
      process.stdout.write(`  ${k}: ${shown}\n`);
    }
    process.stdout.write(`  (body ${Buffer.byteLength(rawBody)} bytes)\n`);
    if (args["dry-run"]) {
      process.stdout.write(`\n[dry-run — no request sent]\n`);
      return;
    }
  }

  let res;
  try {
    res = await postRequest(args.to, headers, rawBody, method);
  } catch (e) {
    process.stderr.write(`✗ request failed: ${e.message}\n`);
    process.exit(1);
  }

  if (args.verbose) {
    process.stdout.write(`\n← ${res.status}\n`);
    for (const [k, v] of Object.entries(res.headers)) {
      process.stdout.write(`  ${k}: ${v}\n`);
    }
    process.stdout.write(`\n${res.body}\n`);
  } else {
    const ok = res.status >= 200 && res.status < 300;
    process.stdout.write(`${ok ? "✓" : "✗"} ${res.status} ${res.body.length} bytes\n`);
    if (!ok && res.body) {
      const preview = res.body.length > 500 ? res.body.slice(0, 500) + "…" : res.body;
      process.stderr.write(preview + "\n");
    }
  }

  process.exit(res.status >= 200 && res.status < 300 ? 0 : 2);
}

main().catch(e => {
  process.stderr.write(`✗ ${e.message}\n`);
  process.exit(1);
});
