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


## Receiver-side security model

Webhook receivers on Kinetic are **`POST` WebAPIs on the `ingest` kapp**, one per vendor (e.g. `/app/kapps/ingest/webApis/autotask-ingest`). Access is controlled via kapp-level Security Policy Definitions:

| Vendor | Receiver URL | Who can call it |
|---|---|---|
| autotask | `.../webApis/autotask-ingest` | `webhook-autotask-sa` only |
| connectwise-manage | `.../webApis/connectwise-manage-ingest` | `webhook-connectwise-manage-sa` only |
| ninjaone | `.../webApis/ninjaone-ingest` | `webhook-ninjaone-sa` only |
| pax8 | `.../webApis/pax8-ingest` | `webhook-pax8-sa` only |
| acronis | `.../webApis/acronis-ingest` | `webhook-acronis-sa` only |
| huntress | `.../webApis/huntress-ingest` | any authenticated user (HMAC verification TODO — Huntress vendor UI doesn't support Basic/Bearer auth headers) |

Each non-Huntress webApi has a kapp-level SPD of `type: "Kapp"` with rule `identity('username') === '<vendor-sa>'` bound to the `Execution` endpoint. Space admins bypass all policies by design, so `john` (admin) can call any URL — vendors must be given the scoped service account credentials, never an admin.

**On the vendor side**, configure the webhook with Basic auth (Autotask, ConnectWise Manage) or a custom `Authorization: Bearer <base64(user:pw)>` header (NinjaOne, Pax8, Acronis). Huntress has no auth config in its UI — it'll be switched to HMAC verification in a follow-up.

## Replaying a payload

Use `bin/webhook-push.mjs` from the repo root:

```bash
node bin/webhook-push.mjs \
  --to https://your-space.kinetics.com/app/kapps/ingest/webApis/autotask-ingest \
  --payload webhook-payloads/autotask/ticket-created.json \
  --basic "webhook-autotask-sa:$AUTOTASK_SA_PW"
```

The `--basic user:pw` flag sends HTTP Basic auth, which is what the receiver SPD checks. For vendors that also expect a signature header, add `--secret <hmac-secret>` — the push tool auto-reads the `_meta.json` in the sibling directory to compute the signature with the correct algorithm.

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
