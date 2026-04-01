#!/usr/bin/env node
// Build the kinetic-integrations repo from existing handlers2 data.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { brandIcons, getIconSvg } from '../admin_apps/integration_catalog/service-icons.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const H2 = path.resolve(__dir, '..', 'handlers', 'handlers2');
const OUT = path.join(__dir, 'connectors');

// First rebuild the manifest from all routine JSONs
const rtnFiles = fs.readdirSync(path.join(H2, 'routines')).filter(f => f.endsWith('.json'));
const rtnByConn = {};
for (const f of rtnFiles) {
  const r = JSON.parse(fs.readFileSync(path.join(H2, 'routines', f), 'utf-8'));
  const conn = (r.connectorHandler || '').replace(/_v1$/, '');
  if (!conn) continue;
  if (!rtnByConn[conn]) rtnByConn[conn] = [];
  rtnByConn[conn].push(r);
}

// Build manifest from routine files + connector directories
const connDirs = fs.readdirSync(path.join(H2, 'connectors')).filter(d => fs.statSync(path.join(H2, 'connectors', d)).isDirectory());
const manifest = [];
for (const dir of connDirs) {
  const conn = dir.replace(/_v1$/, '');
  const prefix = conn.replace(/_connection$/, '');
  const rtns = rtnByConn[conn] || [];
  // Derive service name from the test routine (most reliable) or connector ID
  const testRtn = rtns.find(r => r.name?.endsWith('Connection Test'));
  const service = testRtn
    ? testRtn.name.replace(/ Connection Test$/, '')
    : prefix.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  manifest.push({
    connector: conn,
    service,
    routines: rtns.map(r => ({
      id: (r.definitionId || '').replace(/^routine_/, '').replace(/_v1$/, ''),
      name: r.name,
      method: r.treeJson?.nodes?.find(n => !n.definitionId.startsWith('system_'))?.parameters?.find(p => p.id === 'method')?.value || 'GET',
      path: (r.treeJson?.nodes?.find(n => !n.definitionId.startsWith('system_'))?.parameters?.find(p => p.id === 'url')?.value || '').replace(/<%= @info\['instance_url'\] %>/, ''),
      inputs: (r.inputs || []).map(i => ({ name: i.name, required: !!i.required })),
      outputs: (r.outputs || []).map(o => ({ name: o.name, path: o.path || '' })),
    })),
  });
}
manifest.sort((a, b) => a.service.localeCompare(b.service));

// Docs URLs for known services
const DOCS_URLS = {
  'Salesforce': 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/',
  'ServiceNow': 'https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/',
  'Jira': 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/',
  'Slack': 'https://api.slack.com/methods',
  'Microsoft Teams': 'https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview',
  'GitHub': 'https://docs.github.com/en/rest',
  'GitLab': 'https://docs.gitlab.com/ee/api/rest/',
  'Bitbucket': 'https://developer.atlassian.com/cloud/bitbucket/rest/intro/',
  'Google Workspace': 'https://developers.google.com/workspace',
  'HubSpot': 'https://developers.hubspot.com/docs/api/overview',
  'Zendesk': 'https://developer.zendesk.com/api-reference/',
  'Okta': 'https://developer.okta.com/docs/reference/',
  'Auth0': 'https://auth0.com/docs/api',
  'Twilio': 'https://www.twilio.com/docs/usage/api',
  'SendGrid': 'https://docs.sendgrid.com/api-reference',
  'Shopify': 'https://shopify.dev/docs/api',
  'Stripe': 'https://docs.stripe.com/api',
  'Asana': 'https://developers.asana.com/reference/rest-api-reference',
  'Monday.com': 'https://developer.monday.com/api-reference',
  'Datadog': 'https://docs.datadoghq.com/api/latest/',
  'PagerDuty': 'https://developer.pagerduty.com/api-reference/',
  'Confluence': 'https://developer.atlassian.com/cloud/confluence/rest/v2/intro/',
  'Trello': 'https://developer.atlassian.com/cloud/trello/rest/api-group-actions/',
  'Notion': 'https://developers.notion.com/reference/intro',
  'Linear': 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api',
  'ClickUp': 'https://clickup.com/api/',
  'Freshdesk': 'https://developers.freshdesk.com/api/',
  'Freshservice': 'https://api.freshservice.com/',
  'Intercom': 'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/introduction/',
  'Mailchimp': 'https://mailchimp.com/developer/marketing/api/',
  'DocuSign': 'https://developers.docusign.com/docs/esign-rest-api/reference/',
  'Box': 'https://developer.box.com/reference/',
  'Dropbox': 'https://www.dropbox.com/developers/documentation/http/overview',
  'OneDrive': 'https://learn.microsoft.com/en-us/onedrive/developer/rest-api/',
  'Zoom': 'https://developers.zoom.us/docs/api/',
  'PayPal': 'https://developer.paypal.com/api/rest/',
  'Square': 'https://developer.squareup.com/reference/square',
  'QuickBooks': 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account',
  'Workday': 'https://community.workday.com/sites/default/files/file-hosting/restapi/',
  'BambooHR': 'https://documentation.bamboohr.com/reference/get-employee',
  'ADP': 'https://developers.adp.com/',
  'Snowflake': 'https://docs.snowflake.com/en/developer-guide/sql-api/reference',
  'Databricks': 'https://docs.databricks.com/api/workspace/introduction',
  'Tableau': 'https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api.htm',
  'MongoDB Atlas': 'https://www.mongodb.com/docs/atlas/api/',
  'New Relic': 'https://docs.newrelic.com/docs/apis/rest-api-v2/get-started/introduction-new-relic-rest-api-v2/',
  'Splunk': 'https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTprolog',
  'Grafana': 'https://grafana.com/docs/grafana/latest/developers/http_api/',
  'Prometheus': 'https://prometheus.io/docs/prometheus/latest/querying/api/',
  'Elasticsearch': 'https://www.elastic.co/guide/en/elasticsearch/reference/current/rest-apis.html',
  'Kubernetes': 'https://kubernetes.io/docs/reference/kubernetes-api/',
  'Jenkins': 'https://www.jenkins.io/doc/book/using/remote-access-api/',
  'Docker Hub': 'https://docs.docker.com/docker-hub/api/latest/',
  'Discord': 'https://discord.com/developers/docs/reference',
  'Anthropic Claude': 'https://docs.anthropic.com/en/docs',
  'OpenAI': 'https://platform.openai.com/docs/api-reference',
  'AWS S3': 'https://docs.aws.amazon.com/AmazonS3/latest/API/',
  'Azure AD': 'https://learn.microsoft.com/en-us/graph/api/resources/azure-ad-overview',
  'Cloudflare': 'https://developers.cloudflare.com/api/',
  'Terraform Cloud': 'https://developer.hashicorp.com/terraform/cloud-docs/api-docs',
  'CrowdStrike Falcon': 'https://falcon.crowdstrike.com/documentation/category/apis',
  'Xero': 'https://developer.xero.com/documentation/api/',
  'FreshBooks': 'https://www.freshbooks.com/api/start',
  'NetSuite': 'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1540391670.html',
  'Sage Intacct': 'https://developer.intacct.com/api/',
  'Marketo': 'https://developers.marketo.com/rest-api/',
  'Pardot': 'https://developer.salesforce.com/docs/marketing/pardot/guide/overview.html',
  'Constant Contact': 'https://developer.constantcontact.com/api_reference/index.html',
  'Snyk': 'https://snyk.docs.apiary.io/',
  'CircleCI': 'https://circleci.com/docs/api/v2/',
  'LaunchDarkly': 'https://apidocs.launchdarkly.com/',
  'Webflow': 'https://docs.developers.webflow.com/',
  'WordPress': 'https://developer.wordpress.org/rest-api/',
  'WooCommerce': 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
  'BigCommerce': 'https://developer.bigcommerce.com/docs/rest-catalog',
  'Contentful': 'https://www.contentful.com/developers/docs/references/content-management-api/',
  'LinkedIn': 'https://learn.microsoft.com/en-us/linkedin/shared/api-guide',
};

// ── Category mapping ──
function categorize(service) {
  const n = service.toLowerCase();
  if (/^generic/.test(n)) return 'Generic';
  if (/servicenow|jira|zendesk|freshdesk|freshservice|help scout|front|intercom/.test(n)) return 'ITSM & Service Management';
  if (/salesforce|hubspot|pipedrive|copper|close\.com|zoho crm|dynamics 365$|freshsales/.test(n)) return 'CRM & Sales';
  if (/aws|azure(?! openai)|gcp|google cloud|google vertex|docker|kubernetes|terraform|cloudflare|harbor/.test(n)) return 'Cloud & Infrastructure';
  if (/slack|teams|discord|zoom|webex|twilio|vonage|8x8|ringcentral|bandwidth|plivo/.test(n)) return 'Communication';
  if (/okta|auth0|onelogin|ping identity|cyberark|crowdstrike|sentinel(?!one)|snyk|zscaler|netskope|palo alto|wiz|qualys|tenable|cortex/.test(n)) return 'Security & Identity';
  if (/github|gitlab|bitbucket|jenkins|circleci|jfrog|launchdarkly|linear|notion|confluence|clickup|monday|asana|trello|wrike|smartsheet|basecamp/.test(n)) return 'DevOps & Collaboration';
  if (/workday(?! fin)|bamboo|adp|gusto|namely|oracle hcm|sap success|ceridian|paycom|paylocity|rippling|ukg|icims|lever|greenhouse|jobvite|workable|bullhorn/.test(n)) return 'HR & People';
  if (/stripe|paypal|square|braintree|adyen|bill\.com|quickbooks(?! enterprise)|freshbooks|xero|netsuite|sage intacct/.test(n)) return 'Finance & Payments';
  if (/datadog|new relic|splunk|grafana|prometheus|elastic|dynatrace|honeycomb|lightstep|loggly|logz|graylog|papertrail|sumo|appdynamics|amplitude|heap|mixpanel|pendo|segment|optimizely|google analytics|signalfx/.test(n)) return 'Observability & Analytics';
  if (/shopify|bigcommerce|magento|woocommerce|wordpress|contentful|webflow/.test(n)) return 'Commerce & Content';
  if (/sendgrid|mailchimp|constant contact|marketo|pardot|eloqua/.test(n)) return 'Email & Marketing';
  if (/anthropic|openai|cohere|azure openai/.test(n)) return 'AI & Machine Learning';
  if (/snowflake|databricks|tableau|power bi|mongodb|fivetran|airbyte|dbt|mulesoft/.test(n)) return 'Data & Analytics';
  if (/docusign|hellosign|pandadoc|adobe sign|box|dropbox|onedrive|google workspace/.test(n)) return 'Documents & Storage';
  if (/turbotax|h&r block|taxact|taxslayer|freetax|cash app tax|jackson hewitt|proconnect|lacerte|proseries|drake|ultratax|gosystem|cch|atx(?! |$)|taxwise|crosslink|olt pro|ultimatetax/.test(n)) return 'Tax Software';
  if (/zoho books|dynamics 365 b|odoo|wave|acumatica|sap b|sap s\/4|workday fin|oracle fusion|infor cloud|quickbooks enterprise|sage 50|sage business|accountedge|kashoo|freeagent|patriot|zarmoney|aplos|digits/.test(n)) return 'Accounting';
  if (/instagram|facebook|linkedin|tiktok|twitter|youtube|ebay|amazon seller/.test(n)) return 'Social & Marketplace';
  if (/airtable|smartsheet/.test(n)) return 'DevOps & Collaboration';
  if (/ansible|jamf|opsgenie|pagerduty|victorops|xmatters|bigpanda|statuspage|fastly/.test(n)) return 'Observability & Analytics';
  if (/intune|sap$|sap s/.test(n)) return 'Cloud & Infrastructure';
  if (/atx|h&r|hrblock|cash ?app tax|crosslink|taxwise|taxact|drake|ultratax|gosystem|cch|jackson|olt pro|ultimatetax|turbotax|taxslayer|freetax|proconnect|lacerte|proseries/.test(n)) return 'Tax Software';
  if (/dynamics365 bc|sage bc|sage 50|accountedge|kashoo|freeagent|patriot|zarmoney|aplos|digits|odoo|wave|acumatica/.test(n)) return 'Accounting';
  return 'Other';
}

// ── Parse info.xml → auth properties ──
function parseInfoXml(connectorId) {
  const variants = [connectorId + '_v1', connectorId];
  for (const v of variants) {
    const infoPath = path.join(H2, 'connectors', v, 'process', 'info.xml');
    try {
      const xml = fs.readFileSync(infoPath, 'utf-8');
      const props = [];
      const re = /<info\s+([^>]+)\/?>/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const attrs = m[1];
        const name = (attrs.match(/name="([^"]*)"/) || [])[1] || '';
        if (name === 'default_headers_json') continue; // skip — it's implicit
        const req = (attrs.match(/required="([^"]*)"/) || [])[1] === 'true';
        const type = (attrs.match(/type="([^"]*)"/) || [])[1] || '';
        const desc = (attrs.match(/description="([^"]*)"/) || [])[1] || '';
        const prop = { name, required: req, description: desc };
        if (type === 'encrypted') prop.encrypted = true;
        props.push(prop);
      }
      return props;
    } catch { /* try next */ }
  }
  return null;
}

// ── Detect auth type from properties ──
function detectAuth(props) {
  const names = props.map(p => p.name.toLowerCase());
  if (names.some(n => n === 'token_url') && names.some(n => n === 'client_id')) return 'oauth2';
  if (names.some(n => n === 'client_id') && names.some(n => n === 'refresh_token')) return 'oauth2_refresh';
  if (names.some(n => n.includes('aws_access_key') || n === 'access_key_id' && names.some(n2 => n2.includes('secret')))) return 'aws';
  if (names.some(n => n === 'username') && names.some(n => n === 'password')) return 'basic';
  if (names.some(n => n.includes('api_key') || n.includes('apikey'))) return 'apikey';
  if (names.some(n => n.includes('private_key') || n.includes('service_account'))) return 'jwt';
  return 'bearer';
}

// ── Build connector ID for filenames ──
function fileId(connectorId) {
  return connectorId.replace(/_connection$/, '').replace(/_/g, '-');
}

// ── Process each service ──
console.log('\n  Building kinetic-integrations repository...\n');
const indexEntries = [];
let totalRoutines = 0;

for (const svc of manifest) {
  const connId = svc.connector;
  const props = parseInfoXml(connId);
  const authType = props ? detectAuth(props) : 'bearer';
  const category = categorize(svc.service);
  const fid = fileId(connId);

  // Build routine entries
  const routines = (svc.routines || []).map(r => {
    const routine = {
      id: r.id.replace(new RegExp(`^${connId.replace(/_connection$/, '')}_`), ''),
      name: r.name,
      description: `${r.method} ${r.path}`.trim(),
      method: r.method || 'GET',
      path: r.path || '',
    };

    // Map inputs
    routine.inputs = (r.inputs || []).map(i => {
      const input = { name: i.name, required: !!i.required };
      if (i.description && i.description !== i.name + '.') input.description = i.description;
      // Detect path params
      if (r.path && r.path.includes(`{${i.name.toLowerCase().replace(/ /g, '_')}}`)) {
        input.pathParam = true;
      }
      // mapTo: use input name as default field mapping for POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(r.method) && !input.pathParam) {
        input.mapTo = i.name;
      }
      return input;
    });

    // Map outputs
    routine.outputs = (r.outputs || []).map(o => ({
      name: o.name,
      path: o.path || o.name.toLowerCase().replace(/ /g, '_'),
    }));

    return routine;
  });

  // Build connector JSON
  const connector = {
    id: fid,
    service: svc.service,
    version: 1,
    category,
    description: `${svc.service} integration with ${routines.length} pre-built routines.`,
  };

  // Auth section
  if (props && props.length) {
    connector.auth = {
      type: authType,
      properties: props,
    };
  } else {
    connector.auth = {
      type: authType,
      properties: [
        { name: 'access_token', required: true, encrypted: true, description: `${svc.service} API access token.` },
      ],
    };
  }

  // Icon SVG
  connector.icon = getIconSvg(svc.service);

  // Docs URL
  // Case-insensitive docs URL lookup
  const docsKey = Object.keys(DOCS_URLS).find(k => k.toLowerCase() === svc.service.toLowerCase());
  if (docsKey) connector.docsUrl = DOCS_URLS[docsKey];

  connector.defaultHeaders = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  connector.routines = routines;

  // Write connector file
  const outPath = path.join(OUT, fid + '.json');
  fs.writeFileSync(outPath, JSON.stringify(connector, null, 2));
  totalRoutines += routines.length;

  // Index entry
  indexEntries.push({
    id: fid,
    service: svc.service,
    category,
    auth: authType,
    routines: routines.length,
    description: connector.description,
  });

  process.stdout.write(`  ${fid}.json (${routines.length} routines)\n`);
}

// ── Add generic connectors ──
const GENERICS = [
  { id: 'generic-bearer', service: 'Generic REST (Bearer Token)', auth: 'bearer',
    desc: 'Connect to any REST API using a bearer token.',
    props: [
      { name: 'access_token', required: true, encrypted: true, description: 'Bearer token, API token, or PAT.' },
      { name: 'base_url', required: true, description: 'API base URL (e.g. https://api.example.com).' },
    ]},
  { id: 'generic-basic', service: 'Generic REST (Basic Auth)', auth: 'basic',
    desc: 'Connect to any REST API using username and password.',
    props: [
      { name: 'username', required: true, description: 'Username or email.' },
      { name: 'password', required: true, encrypted: true, description: 'Password or API token.' },
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
  { id: 'generic-apikey-header', service: 'Generic REST (API Key Header)', auth: 'apikey_header',
    desc: 'Connect to any REST API using an API key sent in a custom header.',
    props: [
      { name: 'api_key', required: true, encrypted: true, description: 'API key value.' },
      { name: 'api_key_header', required: false, description: 'Header name (default: X-API-Key).' },
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
  { id: 'generic-apikey-query', service: 'Generic REST (API Key Query)', auth: 'apikey_query',
    desc: 'Connect to any REST API using an API key in the query string.',
    props: [
      { name: 'api_key', required: true, encrypted: true, description: 'API key value.' },
      { name: 'api_key_param', required: false, description: 'Query parameter name (default: api_key).' },
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
  { id: 'generic-oauth2-client', service: 'Generic REST (OAuth2 Client Credentials)', auth: 'oauth2',
    desc: 'Connect to any REST API using OAuth2 client credentials flow (machine-to-machine).',
    props: [
      { name: 'token_url', required: true, description: 'OAuth2 token endpoint.' },
      { name: 'client_id', required: true, description: 'OAuth2 client ID.' },
      { name: 'client_secret', required: true, encrypted: true, description: 'OAuth2 client secret.' },
      { name: 'scope', required: false, description: 'OAuth2 scope (space-delimited).' },
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
  { id: 'generic-oauth2-refresh', service: 'Generic REST (OAuth2 Refresh Token)', auth: 'oauth2_refresh',
    desc: 'Connect to any REST API using an OAuth2 refresh token (user-context).',
    props: [
      { name: 'token_url', required: true, description: 'OAuth2 token endpoint.' },
      { name: 'client_id', required: true, description: 'OAuth2 client ID.' },
      { name: 'client_secret', required: true, encrypted: true, description: 'OAuth2 client secret.' },
      { name: 'refresh_token', required: true, encrypted: true, description: 'Long-lived refresh token.' },
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
  { id: 'generic-aws-v4', service: 'Generic AWS (Signature V4)', auth: 'aws',
    desc: 'Connect to any AWS service using IAM Signature V4 authentication.',
    props: [
      { name: 'access_key_id', required: true, description: 'AWS access key ID.' },
      { name: 'secret_access_key', required: true, encrypted: true, description: 'AWS secret access key.' },
      { name: 'region', required: true, description: 'AWS region (e.g. us-east-1).' },
      { name: 'service', required: true, description: 'AWS service name (e.g. s3, execute-api).' },
      { name: 'base_url', required: true, description: 'Service endpoint URL.' },
    ]},
  { id: 'generic-jwt-rsa', service: 'Generic REST (JWT RSA-SHA256)', auth: 'jwt',
    desc: 'Connect to any REST API using a signed JWT (Google Service Accounts, custom JWT auth).',
    props: [
      { name: 'private_key_pem', required: true, encrypted: true, description: 'RSA private key in PEM format.' },
      { name: 'issuer', required: true, description: 'JWT issuer (iss claim).' },
      { name: 'subject', required: false, description: 'JWT subject (sub claim) — for impersonation.' },
      { name: 'audience', required: true, description: 'JWT audience (aud claim) — usually the token URL.' },
      { name: 'token_url', required: true, description: 'Token endpoint to exchange JWT for access token.' },
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
  { id: 'generic-mtls', service: 'Generic REST (Mutual TLS)', auth: 'mtls',
    desc: 'Connect to any REST API requiring mutual TLS (client certificate authentication).',
    props: [
      { name: 'client_cert_pem', required: true, encrypted: true, description: 'Client certificate in PEM format.' },
      { name: 'client_key_pem', required: true, encrypted: true, description: 'Client private key in PEM format.' },
      { name: 'ca_cert_pem', required: false, encrypted: false, description: 'CA certificate bundle (if not in system trust store).' },
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
  { id: 'generic-noauth', service: 'Generic REST (No Auth)', auth: 'noauth',
    desc: 'Connect to any public or internal REST API that requires no authentication.',
    props: [
      { name: 'base_url', required: true, description: 'API base URL.' },
    ]},
];

console.log('\n  Building generic connectors...');
for (const g of GENERICS) {
  const connector = {
    id: g.id,
    service: g.service,
    version: 1,
    category: 'Generic',
    generic: true,
    description: g.desc,
    auth: { type: g.auth, properties: g.props },
    defaultHeaders: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    routines: [],
  };
  fs.writeFileSync(path.join(OUT, g.id + '.json'), JSON.stringify(connector, null, 2));
  indexEntries.push({
    id: g.id, service: g.service, category: 'Generic', auth: g.auth,
    routines: 0, generic: true, description: g.desc,
  });
  console.log(`  ${g.id}.json (generic)`);
}

// ── Write index.json ──
indexEntries.sort((a, b) => {
  if (a.generic && !b.generic) return 1;
  if (!a.generic && b.generic) return -1;
  return a.service.localeCompare(b.service);
});

const index = {
  version: '1.0',
  updated: new Date().toISOString().slice(0, 10),
  connectors: indexEntries,
};
fs.writeFileSync(path.join(__dir, 'index.json'), JSON.stringify(index, null, 2));

console.log(`\n  ────────────────────────────────────`);
console.log(`  Connectors:  ${indexEntries.length} (${indexEntries.filter(e => !e.generic).length} named + ${GENERICS.length} generic)`);
console.log(`  Routines:    ${totalRoutines}`);
console.log(`  Output:      ${__dir}/`);
console.log(`  ────────────────────────────────────\n`);
