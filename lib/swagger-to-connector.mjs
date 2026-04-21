// swagger-to-connector: convert an OpenAPI 3.x / Swagger 2.0 spec into a
// kinetic-integrations connector JSON document.
//
// Pure Node built-ins. Callers supply the parsed spec (object, not string).
//
// API:
//   swaggerToConnector(spec, opts) → { connector, manifest, warnings }
//
// opts:
//   id             (required) connector id, e.g. "freshdesk"
//   service        display name. Defaults to spec.info.title.
//   category       "ITSM & Service Management" etc. Defaults to "Other".
//   includeTags    array of tag names — only operations with these tags
//   excludeTags    array of tag names — skip operations with these tags
//   includeOps     array of operationIds — only these operations
//   excludeOps     array of operationIds — skip these operations
//   maxRoutines    cap the number of emitted routines (priority: explicit
//                  includeOps > tagged > first N)
//   resolveRefs    (default true) dereference $ref pointers in schemas
//   preferSummary  (default true) use operation.summary for routine name if
//                  present; otherwise derive from operationId/method+path
//   maxOutputs     (default 5) cap named scalar outputs per routine (in
//                  addition to the always-present Response Body / Code / Error)
//
// Returns an object:
//   connector     the connector JSON body (what you'd put in connectors/*.json)
//   manifest      metadata about the import — source spec URL (if any),
//                 operationIds included, overrides, generated-at timestamp
//   warnings      array of human-readable strings about dropped/ambiguous bits

const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean"]);

// Normalize a string into a stable kebab/snake id fragment.
function slugify(s, { separator = "_" } = {}) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9]+/g, separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, "g"), "")
    .toLowerCase();
}

// Humanize: "getTickets" → "Get Tickets", "create_ticket" → "Create Ticket"
function humanize(s) {
  if (!s) return "";
  const withSpaces = String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return withSpaces.replace(/\b\w/g, c => c.toUpperCase());
}

// Given operation.operationId or (method+path), derive a display name.
function deriveRoutineName(op, path, method, serviceName, preferSummary) {
  if (preferSummary && op.summary && op.summary.trim()) {
    const s = op.summary.trim();
    // Prefix with service name if summary doesn't already include it
    return s.toLowerCase().includes(serviceName.toLowerCase()) ? s : `${serviceName} ${s}`;
  }
  if (op.operationId) return `${serviceName} ${humanize(op.operationId)}`;
  // Fall back: derive from method + last path segment
  const segs = path.split("/").filter(Boolean).filter(s => !s.startsWith("{"));
  const verbHuman = {
    get: "Retrieve", post: "Create", put: "Update", patch: "Update", delete: "Delete",
  }[method.toLowerCase()] || method.toUpperCase();
  const resource = humanize(segs[segs.length - 1] || "Resource");
  return `${serviceName} ${resource} ${verbHuman}`;
}

// Same input, derives a routine id (snake_case, unique among a set).
function deriveRoutineId(op, path, method, existingIds) {
  let base = op.operationId ? slugify(op.operationId) : null;
  if (!base) {
    const verb = { get: "get", post: "create", put: "update", patch: "update", delete: "delete" }[method.toLowerCase()] || method.toLowerCase();
    const segs = path.split("/").filter(Boolean).filter(s => !s.startsWith("{"));
    const resource = slugify(segs.join("_") || "resource");
    base = `${resource}_${verb}`;
  }
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}_${n++}`;
  }
  existingIds.add(id);
  return id;
}

// Walk a schema, resolving $ref against the spec's root. Cycle-safe: replaces
// re-entrant refs with { type: "object" }.
function deref(schema, spec, seen = new Set()) {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return { type: "object", description: "(circular)" };
    const nextSeen = new Set(seen); nextSeen.add(schema.$ref);
    const parts = schema.$ref.replace(/^#\//, "").split("/");
    let node = spec;
    for (const p of parts) { node = node?.[p]; if (!node) break; }
    return node ? deref(node, spec, nextSeen) : schema;
  }
  const out = Array.isArray(schema) ? [] : {};
  for (const [k, v] of Object.entries(schema)) {
    out[k] = (v && typeof v === "object") ? deref(v, spec, seen) : v;
  }
  return out;
}

// Extract the request-body schema for an operation. Returns the JSON-body schema
// or null. Looks at first applicable content type.
function requestBodySchema(op, spec) {
  // OpenAPI 3
  if (op.requestBody?.content) {
    const types = Object.keys(op.requestBody.content);
    const pick = types.find(t => t.includes("json")) || types[0];
    const raw = op.requestBody.content[pick]?.schema;
    return raw ? deref(raw, spec) : null;
  }
  // Swagger 2 — parameters with in:body
  if (Array.isArray(op.parameters)) {
    const body = op.parameters.find(p => p.in === "body");
    if (body?.schema) return deref(body.schema, spec);
  }
  return null;
}

// Extract 2xx success response schema for an operation.
function successResponseSchema(op, spec) {
  if (!op.responses) return null;
  const keys = Object.keys(op.responses);
  // Prefer explicit 200 → 201 → 2xx → default
  const order = ["200", "201", "202", "204"];
  let pick = order.find(k => keys.includes(k)) || keys.find(k => /^2/.test(k)) || "default";
  const r = op.responses[pick];
  if (!r) return null;
  // OpenAPI 3
  if (r.content) {
    const types = Object.keys(r.content);
    const t = types.find(x => x.includes("json")) || types[0];
    const raw = r.content[t]?.schema;
    return raw ? deref(raw, spec) : null;
  }
  // Swagger 2
  if (r.schema) return deref(r.schema, spec);
  return null;
}

// Produce input descriptors for a routine from an operation.
// Combines: path params, query params, header params, and top-level body fields.
function routineInputs(op, spec) {
  const inputs = [];
  const seen = new Set();
  const push = (name, required, mapTo, desc) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const entry = { name, required: !!required, mapTo: mapTo || name };
    if (desc) entry.description = desc;
    inputs.push(entry);
  };

  const params = op.parameters || [];
  for (const p of params) {
    if (p.$ref) continue; // rare; skip for simplicity
    if (p.in === "body") continue; // handled below
    if (p.in === "cookie") continue; // skip
    const name = humanize(p.name);
    push(name, p.required, p.name, p.description);
  }

  const body = requestBodySchema(op, spec);
  if (body) {
    const required = new Set(body.required || []);
    const props = body.properties || {};
    for (const [k, v] of Object.entries(props)) {
      // Skip deeply-nested objects; top-level scalar + simple nested only
      const vs = v || {};
      const name = humanize(k);
      push(name, required.has(k), k, vs.description);
    }
    // If body has no properties but has additionalProperties or is raw, add a generic field
    if (!Object.keys(props).length) {
      push("Body", true, "_body", "Raw JSON request body");
    }
  }
  return inputs;
}

// Produce output descriptors. Always adds Response Body, Response Code,
// Handler Error Message. Promotes up to maxOutputs scalar top-level response
// fields to named outputs.
function routineOutputs(op, spec, maxOutputs = 5) {
  const outs = [];
  const seen = new Set();
  const push = (name, path) => {
    if (seen.has(name)) return;
    seen.add(name);
    outs.push({ name, path });
  };

  const resp = successResponseSchema(op, spec);
  if (resp && resp.properties) {
    // Heuristic: promote "important" fields first, then others
    const important = ["id", "uid", "uuid", "name", "email", "status", "state", "code"];
    const entries = Object.entries(resp.properties);
    entries.sort((a, b) => {
      const ai = important.indexOf(a[0].toLowerCase());
      const bi = important.indexOf(b[0].toLowerCase());
      if (ai !== -1 && bi === -1) return -1;
      if (bi !== -1 && ai === -1) return 1;
      if (ai !== bi) return ai - bi;
      return 0;
    });
    let promoted = 0;
    for (const [k, v] of entries) {
      if (promoted >= maxOutputs) break;
      if (!v || typeof v !== "object") continue;
      const t = v.type;
      if (SCALAR_TYPES.has(t) || t === "array") {
        push(humanize(k), k);
        promoted++;
      }
    }
  } else if (resp && resp.type === "array") {
    push("Items", "");
  }

  // Always present
  push("Response Body", "response_body");
  push("Response Code", "response_code");
  push("Handler Error Message", "handler_error_message");
  return outs;
}

// Map securitySchemes → connector auth block with role fields populated.
// Prefers schemes in this order: oauth2 (client_credentials > password) > http.bearer > http.basic > apiKey.
function mapAuth(spec, warnings) {
  const schemes =
    (spec.components && spec.components.securitySchemes) ||
    spec.securityDefinitions || // Swagger 2
    {};

  const entries = Object.entries(schemes);
  if (entries.length === 0) {
    warnings.push("No securitySchemes found — defaulting to bearer auth.");
    return {
      type: "bearer",
      properties: [
        { name: "access_token", role: "access_token", required: true, encrypted: true,
          description: "Bearer access token." },
      ],
    };
  }

  // Pick "best" scheme by priority heuristic
  const score = (s) => {
    const type = (s.type || "").toLowerCase();
    const flow = s.flows ? Object.keys(s.flows)[0] : s.flow; // Swagger 2
    if (type === "oauth2") {
      if (s.flows?.clientCredentials || flow === "application" || flow === "clientCredentials") return 100;
      if (s.flows?.password || flow === "password") return 90;
      return 40; // authorizationCode, implicit — we can't fully automate browser flow
    }
    if (type === "http") {
      if ((s.scheme || "").toLowerCase() === "bearer") return 80;
      if ((s.scheme || "").toLowerCase() === "basic") return 70;
    }
    // Swagger 2: type is directly "basic" (no http.scheme wrapping)
    if (type === "basic") return 70;
    if (type === "apikey" || type === "apiKey") return 60;
    return 10;
  };
  entries.sort((a, b) => score(b[1]) - score(a[1]));
  const [, scheme] = entries[0];
  if (entries.length > 1) {
    warnings.push(`Multiple security schemes found (${entries.map(([n]) => n).join(", ")}); using the best-matched one.`);
  }

  const t = (scheme.type || "").toLowerCase();

  if (t === "oauth2") {
    const flows = scheme.flows || {};
    const cc = flows.clientCredentials;
    const pw = flows.password;
    // Swagger 2 shape
    const swaggerFlow = scheme.flow; // "application" | "password" | ...
    const swaggerTokenUrl = scheme.tokenUrl;

    if (cc || swaggerFlow === "application" || swaggerFlow === "clientCredentials") {
      const tokenUrl = cc?.tokenUrl || swaggerTokenUrl || "";
      const props = [
        { name: "token_url", role: "token_url", required: true,
          defaultValue: tokenUrl, description: "OAuth2 token endpoint." },
        { name: "client_id", role: "client_id", required: true,
          description: "OAuth2 client ID." },
        { name: "client_secret", role: "client_secret", required: true, encrypted: true,
          description: "OAuth2 client secret." },
      ];
      const scopes = cc?.scopes || scheme.scopes;
      if (scopes && Object.keys(scopes).length) {
        props.push({ name: "oauth_scope", role: "oauth_scope", required: false,
          description: `OAuth2 scope (space-delimited). Known scopes: ${Object.keys(scopes).join(", ")}.` });
      }
      return { type: "oauth2", properties: props };
    }
    if (pw || swaggerFlow === "password") {
      const tokenUrl = pw?.tokenUrl || swaggerTokenUrl || "";
      return {
        type: "oauth2_password",
        properties: [
          { name: "token_url", role: "token_url", required: true, defaultValue: tokenUrl,
            description: "OAuth2 token endpoint." },
          { name: "username", role: "username", required: true,
            description: "OAuth2 password-grant username." },
          { name: "password", role: "password", required: true, encrypted: true,
            description: "OAuth2 password-grant password." },
          { name: "client_id", role: "client_id", required: false,
            description: "Optional OAuth2 client ID." },
          { name: "client_secret", role: "client_secret", required: false, encrypted: true,
            description: "Optional OAuth2 client secret." },
        ],
      };
    }
    // Other OAuth2 flows (authorizationCode, implicit) — not fully automatable
    warnings.push("OAuth2 flow is not client_credentials or password — emitting client_credentials scaffold; you may need to handle the flow manually.");
    return {
      type: "oauth2",
      properties: [
        { name: "token_url", role: "token_url", required: true, description: "OAuth2 token endpoint." },
        { name: "client_id", role: "client_id", required: true, description: "OAuth2 client ID." },
        { name: "client_secret", role: "client_secret", required: true, encrypted: true, description: "OAuth2 client secret." },
      ],
    };
  }

  if (t === "http") {
    const s = (scheme.scheme || "").toLowerCase();
    if (s === "bearer") {
      return {
        type: "bearer",
        properties: [
          { name: "access_token", role: "access_token", required: true, encrypted: true,
            description: scheme.bearerFormat ? `Bearer token (${scheme.bearerFormat}).` : "Bearer access token." },
        ],
      };
    }
    if (s === "basic") {
      return {
        type: "basic",
        properties: [
          { name: "username", role: "username", required: true, description: "Username for HTTP Basic auth." },
          { name: "password", role: "password", required: true, encrypted: true, description: "Password for HTTP Basic auth." },
        ],
      };
    }
  }

  // Swagger 2 shorthand: type:"basic" at top level
  if (t === "basic") {
    return {
      type: "basic",
      properties: [
        { name: "username", role: "username", required: true, description: "Username for HTTP Basic auth." },
        { name: "password", role: "password", required: true, encrypted: true, description: "Password for HTTP Basic auth." },
      ],
    };
  }

  if (t === "apikey") {
    const inWhat = (scheme.in || "").toLowerCase(); // "header" | "query" | "cookie"
    const hdrName = scheme.name || "X-API-Key";
    if (inWhat === "header") {
      return {
        type: "apikey",
        properties: [
          { name: "api_key", role: "api_key", required: true, encrypted: true,
            description: `API key sent as the ${hdrName} header.` },
          { name: "api_key_header", role: "api_key_header", required: false,
            defaultValue: hdrName, description: "Header name for the API key." },
        ],
      };
    }
    warnings.push(`API key scheme declares in=${inWhat}; handler assumes header-based. Manual adjustment may be needed.`);
    return {
      type: "apikey",
      properties: [
        { name: "api_key", role: "api_key", required: true, encrypted: true,
          description: "API key." },
      ],
    };
  }

  // Unknown — fallback to bearer
  warnings.push(`Unknown security scheme type "${t}"; defaulting to bearer.`);
  return {
    type: "bearer",
    properties: [
      { name: "access_token", role: "access_token", required: true, encrypted: true, description: "Bearer access token." },
    ],
  };
}

// Derive a baseUrl from spec.servers (OpenAPI 3) or host/basePath/schemes (Swagger 2).
function mapBaseUrl(spec) {
  if (Array.isArray(spec.servers) && spec.servers[0]?.url) {
    // Server URL can contain {vars}; leave as-is (user fills in)
    return spec.servers[0].url.replace(/\/$/, "");
  }
  if (spec.host) {
    const scheme = (Array.isArray(spec.schemes) && spec.schemes[0]) || "https";
    const basePath = spec.basePath || "";
    return `${scheme}://${spec.host}${basePath}`.replace(/\/$/, "");
  }
  return "";
}

// Main entry
export function swaggerToConnector(spec, opts = {}) {
  const warnings = [];
  if (!opts.id) throw new Error("opts.id is required");

  const serviceName = opts.service || spec.info?.title || opts.id;
  const baseUrl = mapBaseUrl(spec);
  const auth = mapAuth(spec, warnings);

  // Walk paths → operations → filter
  const paths = spec.paths || {};
  const selected = []; // { op, path, method }
  const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;

      const tags = op.tags || [];
      if (opts.includeTags?.length && !tags.some(t => opts.includeTags.includes(t))) continue;
      if (opts.excludeTags?.length && tags.some(t => opts.excludeTags.includes(t))) continue;
      if (opts.includeOps?.length && !opts.includeOps.includes(op.operationId)) continue;
      if (opts.excludeOps?.length && opts.excludeOps.includes(op.operationId)) continue;

      selected.push({ op, path, method });
    }
  }

  if (opts.maxRoutines && selected.length > opts.maxRoutines) {
    warnings.push(`Spec has ${selected.length} eligible operations; truncating to maxRoutines=${opts.maxRoutines}.`);
    selected.length = opts.maxRoutines;
  }

  const existingIds = new Set();
  const routines = [];

  // Always add a connection test routine. Prefer a GET on a path with no
  // params; else first operation.
  const testOp = selected.find(x => x.method === "get" && !x.path.includes("{"));
  if (testOp) {
    routines.push({
      id: "test",
      name: `${serviceName} Connection Test`,
      description: `GET ${testOp.path}`,
      method: "GET",
      path: testOp.path,
      inputs: [],
      outputs: [
        { name: "Response Code", path: "response_code" },
        { name: "Connected", path: "connected" },
      ],
    });
    existingIds.add("test");
  }

  const preferSummary = opts.preferSummary !== false;
  const maxOutputs = opts.maxOutputs ?? 5;

  for (const { op, path, method } of selected) {
    const id = deriveRoutineId(op, path, method, existingIds);
    const name = deriveRoutineName(op, path, method, serviceName, preferSummary);
    const inputs = routineInputs(op, spec);
    const outputs = routineOutputs(op, spec, maxOutputs);
    routines.push({
      id,
      name,
      description: `${method.toUpperCase()} ${path}`,
      method: method.toUpperCase(),
      path,
      inputs,
      outputs,
    });
  }

  const connector = {
    id: opts.id,
    service: serviceName,
    version: 1,
    category: opts.category || "Other",
    description: `${serviceName} integration with ${routines.length} pre-built routines (generated from OpenAPI).`,
    auth,
    icon: opts.icon || `<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="12" fill="#6B7280"/><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="700" font-family="sans-serif" fill="white">${escapeXml((serviceName || "?")[0].toUpperCase())}</text></svg>`,
    docsUrl: spec.externalDocs?.url || opts.docsUrl || "",
    defaultHeaders: { Accept: "application/json", "Content-Type": "application/json" },
    baseUrl,
    routines,
  };

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: "swagger2kinetic@0.1.0",
    source: opts.sourceUrl || null,
    specTitle: spec.info?.title || null,
    specVersion: spec.info?.version || null,
    openapiVersion: spec.openapi || spec.swagger || null,
    connectorId: opts.id,
    operations: routines
      .filter(r => r.id !== "test")
      .map(r => ({ id: r.id, method: r.method, path: r.path })),
    filters: {
      includeTags: opts.includeTags || null,
      excludeTags: opts.excludeTags || null,
      includeOps: opts.includeOps || null,
      excludeOps: opts.excludeOps || null,
      maxRoutines: opts.maxRoutines || null,
    },
    warnings,
  };

  return { connector, manifest, warnings };
}

function escapeXml(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

export default swaggerToConnector;
