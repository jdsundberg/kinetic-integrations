# Kinetic Integrations

A publishable library of integration connectors and routines for the [Kinetic Platform](https://kineticdata.com).

**200+ connectors** (named + generic) with **1000+ pre-built routines** across dozens of categories.

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

Add a connector: create `connectors/your-service.json` following the schema in the design doc, then submit a PR.

## License

MIT
