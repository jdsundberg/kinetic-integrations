# Webhook sample payloads

Reference payloads showing what each vendor's webhook sends *into* Kinetic. Pair these with `bin/webhook-push.mjs` to replay them against a local or staging Kinetic WebAPI receiver.

## Scope

Services with the strongest public webhook documentation — each has a per-service directory with one `_meta.json` plus 2–3 example payloads:

| Service | Signing | Events covered |
|---|---|---|
| `autotask/` | HMAC-SHA1 (base64), `X-Autotask-RequestSignature` | ticket-created, ticket-updated, batched-array |
| `connectwise-manage/` | HMAC-MD5 (base64), `X-CW-Signature` | ticket-added, ticket-updated, company-added |
| `ninjaone/` | HMAC-SHA256 (hex) optional, `X-NinjaOne-Signature` | device-offline, condition-triggered, ticket-created |
| `pax8/` | HMAC-SHA256 (hex), `x-pax8-signature` | subscription-created, subscription-updated, usage-report-ready |
| `huntress/` | HMAC-SHA256 (hex), `X-Huntress-Signature` | report-sent, report-updated |
| `acronis/` | Bearer + optional HMAC-SHA256 (hex), `X-Acronis-Signature` | backup-failed, security-malware |

For the broader set (13 MSP services total), see [`docs/webhooks-msp.md`](../docs/webhooks-msp.md) — which describes webhook capabilities, registration flow, and auth model for each. Some services (VSPC, VBR, CW Automate, IT Glue, Rewst) have weaker or non-canonical payload formats and aren't included here.

## `_meta.json` schema

Each service directory has a `_meta.json` documenting:

- `featureName` + `docsUrl` — where to look for vendor docs
- `registration` — UI path, API endpoint, example body for registering a webhook with Kinetic as the target
- `signing` — algorithm, header name, encoding, plus a `format` field describing the exact computation (e.g. `"base64(hmac_sha1(secret, raw_request_body))"`)
- `transport` — content type, method, batching/retry behavior, timeout requirements
- `supportedEventTypes` / `supportedEntities` — list of events the service can emit

## Payload `_source` annotation

Every payload file has a `_source` field at the top that declares provenance:

- `"verbatim from <doc-url>"` — copied unchanged from vendor documentation
- `"synthesized from <envelope + REST response shape>"` — constructed from the documented envelope and the matching REST resource shape. Field values are illustrative.

Treat synthesized payloads as **structurally accurate, valuationally illustrative**. Field names and types should match production; specific values (IDs, timestamps, strings) are made-up and intentionally use `.test` / `.example` domain names where URLs appear.

## Replaying a payload

Use `bin/webhook-push.mjs` from the repo root:

```bash
node bin/webhook-push.mjs \
  --to https://your-space.kinetics.com/app/api/v1/kapps/webhooks/webApis/autotask-ingest \
  --payload webhook-payloads/autotask/ticket-created.json \
  --secret <your-autotask-shared-secret>
```

The tool reads `_meta.json` from the sibling directory, computes the signature per the algorithm declared there, and sets the right header automatically. Add `--dry-run` to preview the request without actually POSTing, `--verbose` to see full request + response detail.

## Using as unit-test fixtures

Each JSON file is a valid JSON document (the `_source` / `_event` / `_queryParams` annotations are ignored by any normal JSON consumer — they're top-level metadata keys). Load them directly in tests:

```ruby
# Ruby example
payload = JSON.parse(File.read("webhook-payloads/autotask/ticket-created.json"))
assert_equal "created", payload["Action"]
assert_equal "Ticket",  payload["EntityType"]
```

```js
// Node example
import fs from "fs";
const payload = JSON.parse(fs.readFileSync("webhook-payloads/autotask/ticket-created.json"));
```

## Contributing more payloads

1. Drop a new `<event-slug>.json` in the appropriate service directory.
2. Top-level `_source` field is required; note either a vendor doc URL or "synthesized from <X>".
3. Don't include real customer data.
4. Keep URLs on `.test` / `.example` / `.example.com` TLDs.
5. Keep timestamps in ISO-8601 where possible; note the timestamp format if it's Unix-float (NinjaOne) or similar.
6. If the event has a corresponding registration shape or a signature quirk, update `_meta.json` rather than duplicating across payload files.
