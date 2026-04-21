# swagger2kinetic

Generate Kinetic connector JSON from an OpenAPI 3.x or Swagger 2.0 specification.

Zero runtime dependencies — pure Node built-ins.

## Install / run

```bash
# Direct via node:
node bin/swagger2kinetic.mjs --spec <url|path> --id <slug> [options]

# Or via npm link (from this repo):
npm link
swagger2kinetic --spec https://example.com/openapi.json --id example
```

## Options

| Flag | Description |
|---|---|
| `--spec <url\|path>` | OpenAPI/Swagger JSON source (required) |
| `--id <slug>` | Connector id, e.g. `freshdesk` (required) |
| `--service <name>` | Display name (defaults to `spec.info.title`) |
| `--category <name>` | Category label (default `"Other"`) |
| `--out <path>` | Output connector JSON (default `connectors/<id>.json`) |
| `--manifest <path>` | Manifest path (default `<out>.manifest.json`) |
| `--include-tags X,Y` | Only operations with these OpenAPI tags |
| `--exclude-tags X,Y` | Skip operations with these tags |
| `--include-ops X,Y` | Only these operationIds |
| `--exclude-ops X,Y` | Skip these operationIds |
| `--max-routines N` | Cap total routines |
| `--max-outputs N` | Cap promoted scalar outputs per routine (default 5) |
| `--docs-url <url>` | Override the doc link |
| `--stdout` | Print to stdout instead of writing files |
| `-h, --help` | Show help |

## Example

```bash
# Freshdesk-like example
node bin/swagger2kinetic.mjs \
  --spec https://api.example.com/openapi.json \
  --id example \
  --service "Example" \
  --category "ITSM & Service Management" \
  --include-tags "Tickets,Contacts" \
  --max-routines 15
```

Produces:
- `connectors/example.json` — the connector body
- `connectors/example.json.manifest.json` — generation metadata (operations selected, source URL, warnings)

## What gets generated

**Auth:** inferred from `components.securitySchemes` (or `securityDefinitions` for Swagger 2). Supported:
- `http.basic` → `basic` with `username`/`password`
- `http.bearer` → `bearer` with `access_token`
- `apiKey` (header) → `apikey` with `api_key` + `api_key_header` (default = the header name from the spec)
- `oauth2.clientCredentials` → `oauth2` with `token_url`/`client_id`/`client_secret` (+ `oauth_scope` if scopes are declared)
- `oauth2.password` → `oauth2_password` with `token_url`/`username`/`password` (+ optional `client_id`/`client_secret`)

Every property gets a `role:` field populated, so the build-process auto-detects semantics even if the spec uses odd field names downstream.

**Routines:** one per HTTP operation matching the filters. Each routine:
- `method`, `path` taken directly from the spec
- `name` derived from `operation.summary` (humanized) or `operation.operationId`
- `inputs` built from `parameters` (path/query/header) + top-level `requestBody` properties
- `outputs` = always-present (`response_body`, `response_code`, `handler_error_message`) + up to `--max-outputs` scalar top-level fields promoted from the 2xx response schema. "Important" names (`id`, `email`, `status`, `name`, …) are promoted first.

**Connection test:** a `test` routine is auto-added using the first GET with no path params.

**$ref resolution:** cycle-safe. Circular refs are replaced with `{ type: "object" }` so the generator never hangs.

## What doesn't get generated

- Dropdown enumerations / field validation — the generator emits `required: bool` and `description`, but doesn't expose enums from the spec.
- Multi-content-type request bodies beyond the first `application/json` variant.
- OAuth2 flows other than `clientCredentials` and `password` emit a scaffold + a warning; you'll need to wire the flow manually.
- AWS SigV4 (not a swagger concept anyway).
- YAML specs — JSON only for now. Use `yaml2json` or similar to convert.

## Human-in-the-loop expected

The output is a **draft**. Always plan to:
1. Review emitted routine names — generated-from-operationId names are OK but often awkward.
2. Prune routines you don't need.
3. Add a proper `icon` (the default is a generic gray circle with the first letter of the service name).
4. Set `category` if you didn't pass one.
5. Test an install against the admin catalog UI and fix any auth property mismatches with a spec author.

## Regeneration

Re-run the generator with the same args. The manifest file records everything used — source URL, filters, operationIds included. If a vendor updates their spec, re-run; compare the new output to the committed JSON; port over any manual name overrides.

A `--from-manifest <path>` mode is a natural next feature (read the manifest, use its filters as defaults, surface name-override overlays). Not implemented yet.

## Tests

```bash
npm test
# or
node tests/test.mjs
```

9 fixture-based tests cover OpenAPI 3 basic/bearer/apikey/oauth2-cc/oauth2-pw, Swagger 2.0, circular $refs, and filter behavior.
