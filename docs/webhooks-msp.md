# MSP Connector Webhooks — Inbound Reference

Reference for the **inbound** direction: how each external service in the MSP integration set can notify Kinetic when something changes on their side. The connector JSONs in this repo describe the *outbound* direction (Kinetic → service); this document covers the complementary *inbound* pattern (service → Kinetic via webhook).

Scope: the 13 MSP-stack connectors added to the catalog:
`autotask`, `datto-rmm`, `veeam-vspc`, `veeam-vbr`, `veeam-vb365`, `connectwise-manage`, `connectwise-automate`, `ninjaone`, `pax8`, `itglue`, `huntress`, `acronis`, `rewst`.

> ⚠️ Webhook capabilities change frequently. Every claim here should be re-verified against the vendor's current docs before production use. Payload shapes in particular drift between versions.

---

## The generic Kinetic receiver pattern

Before diving into each service, the pattern on the Kinetic side is the same across them all:

1. **Expose a WebAPI** on a kapp (e.g. `/app/api/v1/kapps/webhooks/webApis/autotask-ingest`) — this is the URL you give the sending service. WebAPIs can be unauthenticated, basic-auth-protected, or anonymous-with-signature-verification.
2. **Verify the signature** (if the service sends one) as the first step of the WebAPI's workflow tree. HMAC verification is usually a small Ruby handler or an inline ERB step; failed verification returns `401`.
3. **Shape the payload** into a Kinetic submission — either a kapp-form submission (for ticket-like records) or a datastore submission (for events/alerts).
4. **Respond fast** — most webhook senders retry on non-2xx and some have tight timeouts (5–10 s). Dispatch heavy work to a deferred routine; return `200` synchronously.
5. **Idempotency** — webhook deliveries retry. Use the service's event ID (usually in the payload) as an `external_id` field, and treat repeat deliveries of the same ID as no-ops.

Typical WebAPI URL form:

```
POST https://{space}.kinetics.com/app/api/v1/kapps/{kapp}/webApis/{webapi-slug}
Content-Type: application/json
```

---

## 1. Autotask

**Feature name:** Notification Webhooks. Available since v1.6.6.0.

**Events:** Entity-level change events (`created`, `updated`, `deleted`) on: Tickets, Ticket Notes, Companies, Contacts, Configuration Items, Opportunities, Tasks, Time Entries, Projects, Contracts, and a growing list of others (see `/V1.0/WebhookEntity` for the authoritative list).

**Registration:**
- API: `POST /V1.0/*WebhookConfiguration` (per entity — e.g. `/TicketWebhookConfiguration`). You also configure which fields trigger the webhook via `/TicketWebhookField` and which fields are sent in the payload via `/TicketWebhookExcludedResource`.
- UI: Admin > Extensions & Integrations > Integrations > Notification Webhooks.

**Payload:** JSON wrapper with:
```json
{
  "Id": 12345,                // entity ID
  "AccountId": 67,
  "Action": "updated",         // created | updated | deleted
  "EntityType": "Ticket",
  "PersonId": 42,              // who made the change
  "PersonType": "Resource",
  "SequenceNumber": 9871234,
  "Entity": { ... },           // full entity as it would be returned from GET
  "EntityFields": [ ... ]
}
```

**Auth / signing:**
- Configured per webhook as a **secret key** — Autotask sends `X-Autotask-RequestSignature` header containing an HMAC-SHA1 hash of the request body with the shared secret.
- You can also require a Basic auth username/password on the receiving URL — configured in the webhook definition.

**Quirks:**
- Autotask **batches** updates — a single POST may contain an array of entity changes. Payload is an array at the top level when batched.
- Ordering is not guaranteed. Use `SequenceNumber` to detect out-of-order arrivals.
- Autotask retries on non-2xx with exponential backoff for up to 48 h, then disables the webhook.
- There's a deliverability dashboard under the webhook config — check it when troubleshooting.

---

## 2. Datto RMM

**Feature name:** Webhooks (Setup > Extensions > Webhooks).

**Events:** Alert lifecycle — alert raised, alert resolved, alert muted. Also device online/offline if configured as an alert.

**Registration:** UI only. Navigate to *Setup > Extensions > Webhooks*, click New Webhook, paste the URL, select which alert types trigger it. No API endpoint to register webhooks programmatically as of this writing.

**Payload:** JSON with alert context:
```json
{
  "alertUid": "a1b2c3d4-...",
  "alertMessage": "Disk space below threshold",
  "alertPriority": "High",
  "timestamp": "2026-04-21T10:34:22.123Z",
  "deviceUid": "...",
  "deviceHostname": "DC01",
  "siteUid": "...",
  "siteName": "Acme Corp",
  "alertType": "disk_usage",
  "alertThresholdMessage": "..."
}
```

**Auth / signing:** No HMAC signature by default. Datto recommends treating the webhook URL itself as a secret and rotating periodically. You can add custom headers (e.g. a static bearer token) in the webhook configuration for a lightweight shared-secret pattern.

**Quirks:**
- Only a handful of event types. For richer polling, continue using the REST API (`/v2/account/alerts/open`).
- No replay/retry behavior documented — a 500 at the receiver means the event is lost.
- Consider pairing webhook receipt with periodic REST API reconciliation.

---

## 3. Veeam VSPC (Service Provider Console)

**Feature name:** Notifications / Plugins. Weaker than the others — Veeam's MSP play is less webhook-native.

**Events:** Alarms (backup failure, agent heartbeat loss, license thresholds, certificate expiration). Alarm state changes.

**Registration:** Via the VSPC portal under Configuration > Notifications > Channels > Webhook Channel (name varies by version). Some versions expose `/api/v3/notifications/channels` for programmatic registration.

**Payload:** JSON with alarm context — fields include `alarmUid`, `name`, `status`, `severity`, `triggeredOn`, `organizationUid`, `objectUid`. Schema is alarm-type-specific.

**Auth / signing:** Custom static header (you configure a header name + value at registration) — no HMAC option.

**Quirks:**
- Many MSPs skip the webhook and poll `/api/v3/alarms/active` on a 1–5 minute interval. More reliable, no registration drift.
- Webhook payload schema has changed between v5, v6, v7, and v8 releases — always pin to a specific version or tolerate unknown fields.

---

## 4. Veeam VBR (Backup & Replication)

**Feature name:** Webhooks (added in v12). Previously only SMTP + SNMP.

**Events:** Job completion (success, warning, failure), session state changes, malware detection events (v12.1+).

**Registration:** VBR console > General Options > E-mail Notifications / Notifications. As of v12.1 there's limited REST support under `/api/v1/notifications/webhooks`.

**Payload:** JSON summary of the event:
```json
{
  "eventType": "BackupJob",
  "eventResult": "Success",
  "jobName": "Daily File Servers",
  "jobId": "...",
  "sessionId": "...",
  "startTime": "...",
  "endTime": "...",
  "processedObjects": 12,
  "warnings": 0,
  "errors": 0,
  "dataSize": 1234567890
}
```

Malware detection events carry a different shape with `suspiciousFiles`, `detectionType`, `affectedRestorePoints`.

**Auth / signing:** Optional — a static bearer token can be configured. No HMAC.

**Quirks:**
- Self-signed TLS certs are the default — receiver must tolerate or VBR won't POST.
- Webhooks were retrofitted into VBR late; many orgs still rely on the historical pattern: **post-job script** that shells out to curl, or **periodic REST API polling** of `/api/v1/sessions`.
- VBR doesn't retry — a 500 means lost.

---

## 5. Veeam VB365 (Backup for Microsoft 365)

**Feature name:** RESTful Webhook Receiver (v7+).

**Events:** Backup job state changes, restore session events, license threshold warnings.

**Registration:** VB365 console > Configure Notifications > Webhooks, or via API `/v7/WebHooks`.

**Payload:** JSON with event metadata — `organizationId`, `jobId`, `sessionId`, `status`, `errors[]`, `timestamp`.

**Auth / signing:** Optional static token header.

**Quirks:**
- Per-organization scope — each M365 tenant you've backed up can have its own webhook config.
- Most MSPs pair webhooks with daily reporting pulls from `/v7/Statistics` for verified state.

---

## 6. ConnectWise Manage

**Feature name:** Callbacks.

**Events:** CRUD on most entity types — Ticket, TicketNote, Company, Contact, Opportunity, ProjectTicket, Activity, etc. Configured per-event-type per-callback.

**Registration:**
- API: `POST /v4_6_release/apis/3.0/system/callbacks` — body specifies `type` (e.g. "ticket"), `level` ("status"/"owner"/"company"), `objectId`, and the target `url`.
- UI: My Account > Service Activity > System > My Callbacks (permissions-dependent).

**Payload:** JSON with:
```json
{
  "ID": 12345,
  "Action": "updated",
  "Type": "ticket",
  "MemberID": "jdoe",
  "Entity": { ... }          // full entity body
}
```

**Auth / signing:**
- CW Manage computes an **MD5 hash** of a concatenated secret + payload and sends in a signature header — weaker than HMAC-SHA256 but workable.
- Alternative: use an authenticated WebAPI URL that includes a token in the path or Basic-auth header, since CW Manage lets you put auth in the callback URL itself.

**Quirks:**
- CW Manage expects a `200 OK` within ~5 seconds or it retries aggressively. Dispatch the heavy work to a deferred routine.
- `level` scoping is critical — you can register a callback at the *company* level (only this company's tickets), *status* level (this board/status), or globally. Most MSPs register one global callback per entity type and filter receiver-side.
- Callback failures show up in CW Manage under Audit Trail > Callback Activity.

---

## 7. ConnectWise Automate

**Feature name:** No first-class webhooks. Event scripts + Extra Data Fields are the primitive.

**Events:** Script-driven — any event surface-able in an Automate script can POST outbound via Automate's HTTP actions.

**Registration:** You write an Automate script (in the Solution Center or custom) that triggers on a monitor/alert and calls out via `Invoke HTTP` step. Register the script to a monitor.

**Payload:** Whatever your script sends — no standard. Typically you'd template a JSON body using Automate's `@computername@`, `@alertmessage@`, etc. replacement tokens.

**Auth / signing:** Whatever your script adds to the outbound request.

**Quirks:**
- In practice, most Automate → external integrations flow **through** CW Manage (Automate creates a Manage ticket; Manage's callback fires to the external system). If you're running Manage + Automate together, you probably only need the Manage callback above.
- Plan Group is another option — "Group Scheduled Scripts" can periodically fire an HTTP POST.

---

## 8. NinjaOne

**Feature name:** Webhooks (Administration > Apps > Webhooks).

**Events:** Device events (online, offline, agent updated), condition triggered (custom monitor conditions), patch events, antivirus events, ticket events, software install/uninstall events.

**Registration:** UI only under Administration > Apps > Webhooks. No documented API to register webhooks programmatically.

**Payload:** JSON varies per event type:
```json
{
  "entityType": "DEVICE",
  "action": "OFFLINE",
  "timestamp": 1713691234567,
  "organizationId": 42,
  "deviceId": 1234,
  "deviceDisplayName": "DC01",
  "properties": { ... }
}
```

**Auth / signing:** Configurable — you can add custom headers (e.g. a static bearer token) on the webhook config. NinjaOne supports HMAC-SHA256 signing in the `X-NinjaOne-Signature` header when enabled.

**Quirks:**
- Very clean event taxonomy compared to older RMMs. Good first-choice for RMM → Kinetic integrations.
- Webhook config lets you filter by organization and event type — useful for multi-tenant MSPs that want per-customer routing.
- NinjaOne retries failed deliveries with exponential backoff for ~24 h.

---

## 9. Pax8

**Feature name:** Partner Webhooks (rolled out 2023).

**Events:** Subscription lifecycle (`subscription.created`, `subscription.updated`, `subscription.cancelled`, `subscription.reactivated`), company lifecycle (`company.created`, `company.updated`), order lifecycle (`order.completed`), usage report availability (`usage_report.ready`).

**Registration:**
- API: `POST /v1/webhooks` with `eventTypes[]` and `url`.
- UI: Pax8 Admin > Settings > Webhooks.

**Payload:** Event envelope:
```json
{
  "id": "evt_...",
  "eventType": "subscription.updated",
  "eventTimestamp": "2026-04-21T10:34:22Z",
  "partnerId": "...",
  "data": { "subscriptionId": "...", ... }
}
```

**Auth / signing:** HMAC-SHA256 in `x-pax8-signature` header. Shared secret returned once when you create the webhook — store it immediately.

**Quirks:**
- Rate-limited deliveries during marketplace-wide events (e.g. Microsoft price changes can generate thousands of `subscription.updated` events in minutes).
- `usage_report.ready` is the critical event for MSPs doing usage-based billing — fires monthly per partner.
- Event IDs are stable; use for idempotency.

---

## 10. IT Glue

**Feature name:** Webhooks (MyGlue and full IT Glue).

**Events:** Historically thin. Recent releases added asset changes (configuration updated, flexible asset updated, password accessed, password modified), organization changes.

**Registration:** UI under Account > Webhooks. Some tiers require Kaseya IT Complete integration enabled.

**Payload:** JSON object with `eventType`, `resourceId`, `resourceType`, `organizationId`, `timestamp`, `userId`, and an `attributes` map of the changed fields.

**Auth / signing:** Shared secret, HMAC-SHA256 in `X-ITGlue-Signature`.

**Quirks:**
- Kaseya account tier determines what's available. Many legacy IT Glue accounts don't see the webhook UI.
- Password-access events require the *Audit Trail* add-on.
- In practice most MSPs doing IT Glue integrations still **poll the REST API** on a timer — webhook coverage isn't comprehensive enough.

---

## 11. Huntress

**Feature name:** Webhooks (Account > Settings > Integrations > Webhooks).

**Events:** Incident reports — `report.sent`, `report.updated`, `report.closed`. Agent events: `agent.created`, `agent.updated`. Billing events: `billing_report.ready`.

**Registration:** UI only — paste URL, pick event types. No documented API registration endpoint.

**Payload:** JSON:
```json
{
  "event": "report.sent",
  "sent_at": "2026-04-21T10:34:22Z",
  "payload": {
    "incident_report_id": 789,
    "organization_id": 42,
    "agent_id": 1234,
    "status": "sent",
    "severity": "high",
    "summary": "..."
  }
}
```

**Auth / signing:** HMAC-SHA256 in `X-Huntress-Signature`. Secret shown once at creation.

**Quirks:**
- Incident report webhooks are the critical integration point — MSPs commonly fan these to PSA ticket creation via Kinetic.
- Huntress is picky about receiver response time; must return `2xx` in <5 seconds.

---

## 12. Acronis Cyber Protect

**Feature name:** Event Service Subscriptions (newer API-driven) + legacy notification profiles.

**Events:** Backup events, security events, alerts. Per-tenant scoping.

**Registration:**
- API: `POST /api/event_service/v2/subscriptions` with `event_type_patterns[]` and `target` (webhook URL).
- UI: Management Portal > Integrations > Webhooks.

**Payload:** Event envelope:
```json
{
  "id": "...",
  "event_type": "resource.backup.failed",
  "tenant_id": "...",
  "created_at": "...",
  "data": { ... }
}
```

**Auth / signing:** OAuth2 bearer token (Acronis signs its own requests with a token you issue it), or optional HMAC-SHA256.

**Quirks:**
- Two parallel systems — the old Alert Manager webhook and the new Event Service subscriptions. Event Service is the strategic path.
- Per-tenant registration — MSP partners need to register webhooks per customer tenant or use the aggregated `subscribe_to_descendants` flag (newer).
- Event backfill is supported via `list events` with a time range — use to recover from outages.

---

## 13. Rewst

**Direction inversion:** Rewst is itself an automation platform. Typically the integration pattern is:

- **Rewst → Kinetic**: Rewst workflows call out to Kinetic WebAPIs as a workflow action (`HTTP` step). This is the common direction.
- **Kinetic → Rewst**: Kinetic fires a Rewst webhook trigger (the `workflow_trigger_webhook` routine in the `rewst` connector).

So Rewst doesn't fit the "inbound webhook" pattern the same way — it's more of a peer orchestrator.

**When Rewst sends to Kinetic (outbound from Rewst):**
- Events: whatever your Rewst workflow sends — it's under your control.
- Payload: whatever you template inside the Rewst workflow's HTTP step.
- Auth: configurable per step — static bearer, Basic auth, or HMAC signing via Rewst's built-in functions.
- Registration: no registration — just add an HTTP step in a Rewst workflow and point it at a Kinetic WebAPI URL.

**Quirks:**
- Because the payload shape is entirely under your control, treat Rewst-originated webhooks as internal-trusted but still verify auth tokens.
- If Rewst is the orchestrator and other tools notify Rewst, you often **don't need direct webhooks** from those tools to Kinetic — Rewst aggregates, then calls Kinetic with a normalized shape.

---

## Coverage summary

| Connector | Webhook support | Auth/signing | Registration | Kinetic pattern |
|---|---|---|---|---|
| autotask | ✅ Strong | HMAC-SHA1 + optional Basic | API + UI | Verify sig → kapp submission |
| datto-rmm | ✅ Alerts only | Static header token | UI only | Verify header → datastore submission |
| veeam-vspc | ⚠️ Limited | Static header token | UI (limited API) | Polling often preferred |
| veeam-vbr | ⚠️ Basic (v12+) | Static bearer | UI (partial API) | Polling fallback |
| veeam-vb365 | ✅ v7+ | Static bearer | API + UI | Per-org dispatch |
| connectwise-manage | ✅ Strong | MD5 sig or URL auth | API + UI | Async dispatch, fast ACK |
| connectwise-automate | ❌ None native | Script-defined | Via script | Usually routes via CW Manage |
| ninjaone | ✅ Strong | HMAC-SHA256 optional | UI only | Multi-tenant filtering |
| pax8 | ✅ Strong | HMAC-SHA256 required | API + UI | Event-ID idempotency critical |
| itglue | ⚠️ Tier-dependent | HMAC-SHA256 | UI | Polling often preferred |
| huntress | ✅ Strong | HMAC-SHA256 required | UI only | Sub-5s ACK mandatory |
| acronis | ✅ Strong (Event Service) | OAuth2 bearer + optional HMAC | API + UI | Two APIs — prefer new one |
| rewst | N/A (orchestrator) | Caller-defined | In-workflow step | Treat as trusted peer |

## General recommendations for Kinetic receivers

1. **Default to HMAC verification when available.** Static bearer tokens are fine for low-risk events (Datto RMM alerts) but never for state-changing events (ticket creation, subscription updates).
2. **Always prefer event-ID idempotency over "at-least-once" compensating logic.** Every service on this list has an event/entity ID you can dedupe against.
3. **Return `2xx` fast.** Offload work to deferred routines. Huntress and ConnectWise Manage both disable webhooks after ~5s timeouts.
4. **Reconcile periodically.** Even with webhooks, poll the REST API nightly to catch events lost to outages or disabled webhooks. Every connector in this repo has a matching `*_search` or `*_list` routine for this purpose.
5. **Log every delivery.** Store the raw payload + headers + verification result in a datastore form. Invaluable for debugging.
