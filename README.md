# Kinetic Integrations

A publishable library of integration connectors and routines for the [Kinetic Platform](https://kineticdata.com).

**280+ connectors** (named + generic) with **1000+ pre-built routines** across dozens of categories.

## Structure

```
index.json              Lightweight catalog for browsing
connectors/
  salesforce.json       Connector + all its routines (self-contained)
  servicenow.json
  generic-bearer.json   Generic auth-template connector
  ...
```

Each connector JSON file is self-contained — it includes the connector definition (auth type, connection properties) and all of its routines (method, path, inputs, outputs).


## Tooling

Beyond the connector library, this repo ships two CLI tools (zero runtime dependencies, Node 18+ built-ins only):

### `bin/swagger2kinetic.mjs` — generate connectors from OpenAPI specs

Given a vendor's OpenAPI 3.x or Swagger 2.0 JSON, generates a full connector document: auth block + one routine per HTTP operation + connection-test routine + manifest. Filters by tag or operationId; caps routine count; resolves `$ref`s safely.

```bash
node bin/swagger2kinetic.mjs \
  --spec https://api.example.com/openapi.json \
  --id example \
  --category "ITSM & Service Management" \
  --include-tags "Tickets,Contacts" \
  --max-routines 20
```

Produces `connectors/example.json` + `connectors/example.json.manifest.json`. See [`docs/swagger2kinetic.md`](docs/swagger2kinetic.md) for the full option list and behavior.

### `bin/webhook-push.mjs` — replay webhook payloads into a Kinetic receiver

Local-dev harness for building webhook-receiving WebAPIs. Reads a payload JSON + a sibling `_meta.json` describing the vendor's signing algorithm (HMAC-SHA1 / SHA256 / MD5), computes the correct signature header, and POSTs to your receiver URL.

```bash
node bin/webhook-push.mjs \
  --to https://your-space.kinetics.com/app/api/v1/kapps/webhooks/webApis/autotask-ingest \
  --payload webhook-payloads/autotask/ticket-created.json \
  --secret "$AUTOTASK_WEBHOOK_SECRET"
```

### `webhook-payloads/` — sample webhook fixture library

Reference payloads for the strongest-documented MSP services (Autotask, ConnectWise Manage, NinjaOne, Pax8, Huntress, Acronis). Each service directory has one `_meta.json` (signing config, registration method, supported events) plus 2-3 example payloads annotated with their provenance. Usable directly as receiver-side test fixtures, or replayed via `webhook-push.mjs`.

See [`docs/webhooks-msp.md`](docs/webhooks-msp.md) for the broader per-service webhook capability reference (13 MSP services).

### Tests

```bash
npm test
```

Runs the swagger2kinetic fixture test suite (9 cases covering all auth styles, Swagger 2.0, circular refs, and filters).

## Usage

The [Integration Catalog](https://github.com/jdsundberg/kinetic-admin-tools) admin app reads this repository and:

1. Displays the catalog for browsing and searching
2. Generates Kinetic Task Engine handler code from the connector JSON
3. Generates workflow routine trees from the routine definitions
4. Uploads everything to the platform with one click

## Categories

| Category | Connectors |
|---|---|
| Cloud & Infrastructure | 20+ |
| Accounting | 19+ |
| Tax Software | 25+ |
| Observability & Analytics | 16+ |
| DevOps & Collaboration | 16+ |
| Communication | 8+ |
| ITSM & Service Management | 6+ |
| HR & People | 6+ |
| Security & Identity | 5+ |
| Finance & Payments | 5+ |
| Email & Marketing | 6+ |
| Documents & Storage | 5+ |
| Data & Analytics | 5+ |
| CRM & Sales | 2+ |
| Commerce & Content | 1+ |
| Generic | 10+ |

## Generic Connectors

For systems without a named connector, use a generic:

- **Bearer Token** — most modern APIs
- **Basic Auth** — username/password
- **API Key (Header)** — custom header name
- **API Key (Query)** — query string parameter
- **OAuth2 Client Credentials** — machine-to-machine
- **OAuth2 Refresh Token** — user-context
- **AWS Signature V4** — any AWS service
- **JWT RSA-SHA256** — Google SAs, custom JWT
- **Mutual TLS** — client certificate
- **No Auth** — public/internal APIs

## Contributing

Add a connector: create `connectors/your-service.json` following the schema in the design doc (or generate from an OpenAPI spec via `swagger2kinetic`), then submit a PR.

## License

MIT
