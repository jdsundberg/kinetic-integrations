// Run: node tests/test.mjs
// Exit 0 on pass, non-zero on fail.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import swaggerToConnector from "../lib/swagger-to-connector.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");
const load = (n) => JSON.parse(fs.readFileSync(path.join(fixtures, n), "utf8"));

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    pass++;
  } catch (e) {
    console.log(`❌ ${name}\n   ${e.message}`);
    fail++;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || "eq"}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }

// ─── OpenAPI 3 basic auth ──────────────────────────────────────────────────
test("openapi3 basic: auth + routines + filters", () => {
  const spec = load("oapi3-basic.json");
  const { connector, manifest, warnings } = swaggerToConnector(spec, {
    id: "acme",
    category: "ITSM & Service Management",
    excludeTags: ["Admin"],
  });

  eq(connector.id, "acme", "id");
  eq(connector.service, "AcmeApp", "service");
  eq(connector.auth.type, "basic");

  // Auth properties have roles
  const usernameProp = connector.auth.properties.find(p => p.role === "username");
  const passwordProp = connector.auth.properties.find(p => p.role === "password");
  assert(usernameProp, "username role missing");
  assert(passwordProp, "password role missing");
  assert(passwordProp.encrypted, "password should be encrypted");

  // baseUrl
  eq(connector.baseUrl, "https://api.acme.test/v1");

  // Connection test routine
  const testRoutine = connector.routines.find(r => r.id === "test");
  assert(testRoutine, "test routine missing");

  // listTickets should exist
  const list = connector.routines.find(r => r.id === "listtickets");
  assert(list, "listTickets routine missing");
  eq(list.method, "GET");

  // createTicket should have body inputs
  const create = connector.routines.find(r => r.id === "createticket");
  assert(create, "createTicket missing");
  assert(create.inputs.some(i => i.mapTo === "subject"), "subject input missing");
  assert(create.inputs.some(i => i.mapTo === "subject" && i.required), "subject should be required");

  // Admin op excluded by excludeTags
  assert(!connector.routines.find(r => r.id.includes("dangerous")), "Admin op should have been excluded");

  // Outputs include promoted scalars + canonical 3
  const getOne = connector.routines.find(r => r.id === "getticket");
  assert(getOne.outputs.some(o => o.path === "id"), "id output missing");
  assert(getOne.outputs.some(o => o.path === "status"), "status output missing");
  assert(getOne.outputs.some(o => o.path === "response_body"), "response_body output missing");

  // Manifest
  eq(manifest.connectorId, "acme");
  assert(manifest.operations.length >= 3, "manifest should list operations");
  assert(manifest.openapiVersion?.startsWith("3"), "openapiVersion");
});

// ─── OpenAPI 3 bearer ─────────────────────────────────────────────────────
test("openapi3 bearer: auth + promoted outputs", () => {
  const spec = load("oapi3-bearer.json");
  const { connector } = swaggerToConnector(spec, { id: "bearer-app" });
  eq(connector.auth.type, "bearer");
  const tokenProp = connector.auth.properties.find(p => p.role === "access_token");
  assert(tokenProp?.encrypted);

  const getMe = connector.routines.find(r => r.id === "getme");
  assert(getMe, "getMe missing");
  // id, email, name promoted — plus canonical
  assert(getMe.outputs.find(o => o.path === "id"), "id output");
  assert(getMe.outputs.find(o => o.path === "email"), "email output");
  assert(getMe.outputs.find(o => o.path === "name"), "name output");
});

// ─── OpenAPI 3 apikey ────────────────────────────────────────────────────
test("openapi3 apikey: header name preserved", () => {
  const spec = load("oapi3-apikey.json");
  const { connector } = swaggerToConnector(spec, { id: "keyed" });
  eq(connector.auth.type, "apikey");
  const hdr = connector.auth.properties.find(p => p.role === "api_key_header");
  assert(hdr, "api_key_header role missing");
  eq(hdr.defaultValue, "X-Custom-Key");
});

// ─── OpenAPI 3 OAuth2 client_credentials ─────────────────────────────────
test("openapi3 oauth2 client_credentials: token_url + scopes", () => {
  const spec = load("oapi3-oauth2-cc.json");
  const { connector } = swaggerToConnector(spec, { id: "cc-app" });
  eq(connector.auth.type, "oauth2");
  const tokenUrl = connector.auth.properties.find(p => p.role === "token_url");
  eq(tokenUrl.defaultValue, "https://api.cc.test/oauth/token");
  assert(connector.auth.properties.find(p => p.role === "client_id"));
  assert(connector.auth.properties.find(p => p.role === "client_secret")?.encrypted);
  const scope = connector.auth.properties.find(p => p.role === "oauth_scope");
  assert(scope, "oauth_scope missing");
  assert(scope.description.includes("read") && scope.description.includes("write"), "scopes not documented");
});

// ─── OpenAPI 3 OAuth2 password ──────────────────────────────────────────
test("openapi3 oauth2 password: emits oauth2_password", () => {
  const spec = load("oapi3-oauth2-pw.json");
  const { connector } = swaggerToConnector(spec, { id: "pw-app" });
  eq(connector.auth.type, "oauth2_password");
  assert(connector.auth.properties.find(p => p.role === "username"));
  assert(connector.auth.properties.find(p => p.role === "password")?.encrypted);
  const tokenUrl = connector.auth.properties.find(p => p.role === "token_url");
  eq(tokenUrl.defaultValue, "https://api.pw.test/oauth/token");
});

// ─── Swagger 2.0 ─────────────────────────────────────────────────────────
test("swagger2: host/basePath/schemes → baseUrl, body param → inputs", () => {
  const spec = load("swagger2.json");
  const { connector, manifest } = swaggerToConnector(spec, { id: "legacy" });
  eq(connector.baseUrl, "https://legacy.test/api/v1");
  eq(connector.auth.type, "basic");
  eq(manifest.openapiVersion, "2.0");

  const createUser = connector.routines.find(r => r.id === "createuser");
  assert(createUser, "createUser missing");
  const emailInput = createUser.inputs.find(i => i.mapTo === "email");
  assert(emailInput, "email input missing");
  assert(emailInput.required, "email should be required");
});

// ─── Circular $ref safety ──────────────────────────────────────────────
test("circular refs: generator doesn't hang and produces routine", () => {
  const spec = load("oapi3-circular.json");
  const { connector } = swaggerToConnector(spec, { id: "circ" });
  const getNode = connector.routines.find(r => r.id === "getnode");
  assert(getNode, "getNode missing");
  // id is scalar — should be in outputs; parent/children shouldn't crash
  assert(getNode.outputs.find(o => o.path === "id"), "id output");
  assert(getNode.outputs.find(o => o.path === "response_body"));
});

// ─── includeOps / maxRoutines ─────────────────────────────────────────
test("filters: includeOps + maxRoutines", () => {
  const spec = load("oapi3-basic.json");
  const { connector } = swaggerToConnector(spec, {
    id: "acme", includeOps: ["listTickets", "getTicket"],
  });
  // Test routine + 2 filtered = 3
  eq(connector.routines.length, 3);

  const { connector: trimmed } = swaggerToConnector(spec, { id: "acme", maxRoutines: 1 });
  // test routine + 1 = 2
  assert(trimmed.routines.length <= 2);
});

// ─── ID uniqueness ─────────────────────────────────────────────────────
test("id uniqueness: duplicate operationIds get suffixed", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Dupes" },
    servers: [{ url: "https://x" }],
    components: { securitySchemes: { b: { type: "http", scheme: "bearer" } } },
    paths: {
      "/a": { get: { operationId: "foo", responses: { 200: {} } } },
      "/b": { get: { operationId: "foo", responses: { 200: {} } } },
    },
  };
  const { connector } = swaggerToConnector(spec, { id: "dupes" });
  const ids = connector.routines.map(r => r.id);
  const unique = new Set(ids);
  eq(ids.length, unique.size, "IDs should be unique");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
