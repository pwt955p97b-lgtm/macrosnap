# MacroSnap private beta on Vercel

MacroSnap's beta is intended for a **protected Vercel Preview deployment only**. The AI route always returns `403 PRODUCTION_AI_DISABLED` when `VERCEL_ENV=production`, regardless of feature flags. Do not promote the preview to production.

## Protection layers

1. Enable Vercel Deployment Protection for Preview deployments and use a Shareable Link. This keeps the preview out of ordinary public access without requiring each tester to own a Vercel account.
2. Give each tester a different single-use MacroSnap invitation link. A successful redemption creates a seven-day, signed, HttpOnly, SameSite=Lax, Secure cookie.
3. Connect a Redis-compatible Vercel Marketplace integration. Atomic counters enforce 10 analyses per tester per UTC day and `MACROSNAP_BETA_GLOBAL_DAILY_LIMIT` across all serverless instances. If Redis is unavailable, the AI route fails closed before contacting OpenAI.

The Vercel Shareable Link is the outer deployment gate. The MacroSnap invitation identifies one tester for limits and session separation. Do not reuse one invitation for multiple people.

## Create tester invitation links safely

Generate one URL-safe random token per tester on a trusted local machine. Do not put plaintext tokens or complete invitation URLs in Git, chat, build logs, or Vercel environment variables.

```bash
openssl rand -hex 24
```

Hash each generated token locally:

```bash
printf '%s' 'PASTE_ONE_TOKEN_LOCALLY' | openssl dgst -sha256
```

Build a compact JSON object that maps a non-sensitive tester ID to each lowercase hash:

```json
{"tester-01":"64_HEX_CHARACTERS","tester-02":"64_HEX_CHARACTERS"}
```

Store the JSON as the secret `MACROSNAP_BETA_INVITE_HASHES_JSON`. MacroSnap cannot recover tokens from hashes.

After creating the Vercel Shareable Link, append each tester's plaintext token as a URL fragment. Preserve any Vercel query parameter before the `#`:

```text
https://preview.example/?__vercel_share=VERCEL_VALUE#invite=PLAINTEXT_TESTER_TOKEN
```

The fragment is not transmitted in the HTTP request, so it does not enter Vercel or application access logs. MacroSnap captures it in a before-interactive browser script, removes it from the address bar immediately, deletes the temporary in-memory copy after starting redemption, and sends it only in a JSON POST body that the application never logs. A `Referrer-Policy: no-referrer` response header supplies an additional safeguard.

Each invitation is atomically marked as redeemed in Redis and cannot establish a session on another browser. Send the complete link through a private channel. If a tester ends or loses their seven-day session, generate a new token, replace that tester's hash, and redeploy the Preview.

Generate the signing secret separately:

```bash
openssl rand -base64 48
```

Store that value as `MACROSNAP_SESSION_SECRET`. Rotating it immediately signs every tester out.

## Required Preview environment variables

Configure these under **Vercel Project → Settings → Environment Variables**, scoped to **Preview only**:

| Variable | Type | Purpose |
| --- | --- | --- |
| `MACROSNAP_BETA_ENABLED` | Plain | Set to `true` only for the beta preview. |
| `MACROSNAP_BETA_INVITE_HASHES_JSON` | Secret | Tester ID to SHA-256 invitation-token-hash JSON. |
| `MACROSNAP_SESSION_SECRET` | Secret | Random signing secret, at least 32 bytes. |
| `MACROSNAP_BETA_GLOBAL_DAILY_LIMIT` | Plain | Global UTC-day cap; start with `100` or lower. |
| `OPENAI_API_KEY` | Secret | Server-only OpenAI credential. Never prefix with `NEXT_PUBLIC_`. |
| `OPENAI_GPT6_LUNA_INPUT_USD_PER_MILLION` | Plain | Current published input-token rate. |
| `OPENAI_GPT6_LUNA_OUTPUT_USD_PER_MILLION` | Plain | Current published output-token rate. |
| `UPSTASH_REDIS_REST_URL` | Secret | REST URL supplied by the Redis integration. |
| `UPSTASH_REDIS_REST_TOKEN` | Secret | REST token supplied by the Redis integration. |

The code also accepts the legacy Vercel KV names `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Do not configure both pairs.

Leave `MACROSNAP_AI_ENABLED` unset or `false` on Vercel. It is only the local-development switch and cannot enable AI on production.

## Durable store without unapproved spend

Create a Redis-compatible integration from the Vercel Marketplace only after confirming that the selected plan has no required charge. The repository installs the free client library but does not create a database, subscribe to a plan, or enable billing. Set a provider usage alert/cap if available. If a no-cost plan is unavailable, stop and request approval instead of deploying the beta.

The durable data contains tester IDs, invitation-token hashes, redemption markers, UTC dates, and integer request counts only. It does not contain plaintext invitation tokens, complete links, photos, nutrition results, or OpenAI keys. Counter keys expire at the next UTC-day boundary; redemption markers remain so links stay single-use.

### Verified Upstash free-plan fit

Verified against Upstash's official Redis documentation on November 16, 2026:

- The Free plan is $0/month, requires no credit card, includes one database, 250 MB of data, and 500,000 commands per month.
- The REST API supports scripting, and `EVAL` is available through the same REST credentials used by `@upstash/redis`.
- Upstash bills an `EVAL` plus each `redis.call` inside the script as commands. MacroSnap's successful analysis-quota script uses at most seven billed commands. With the default global cap of 100 analyses per UTC day, analysis counters use at most about 21,000 commands in a 30-day month, excluding the much smaller invitation-attempt traffic. Each one-time invitation redemption adds only two commands. The small integer and redemption keys are far below 250 MB.

This makes the implementation compatible with the current Free plan for a small beta. Use a single free database and leave the account without a payment method if zero spend is required: Upstash states that adding a payment method moves free resources to paid plans. Free databases also have less redundancy than paid databases; MacroSnap therefore fails closed and makes no OpenAI request when Redis is unavailable.

Official references: [Pricing & Billing](https://upstash.com/docs/redis/overall/billing), [EVAL](https://upstash.com/docs/redis/commands/scripting/eval), and [REST API compatibility](https://upstash.com/docs/redis/features/restapi#rest---redis-api-compatibility).

## Create the protected preview and Shareable Link

1. Import the GitHub repository into Vercel, or connect the existing Vercel project.
2. In **Project Settings → Deployment Protection**, enable Vercel Authentication for **Preview** deployments. Do not change production protection or domain settings.
3. Add the Preview-scoped variables above. Ensure Production does not receive `MACROSNAP_BETA_ENABLED=true`.
4. Deploy the beta branch as a Preview deployment. Do not merge it into `main` and do not promote it to Production.
5. Open the Preview deployment in the Vercel dashboard, choose **Share**, and create/copy a **Shareable Link** for that deployment.
6. Append a different tester token to the Shareable Link as `#invite=TOKEN`, then open that complete link in a private browser window.
7. Confirm the outer Vercel gate, automatic MacroSnap session, immediate removal of the fragment from the address bar, and one AI analysis.
8. Send each tester only their own complete invitation link through a private channel.

Vercel changes labels occasionally. If **Shareable Link** is unavailable, verify that Deployment Protection is enabled for the preview and that the current Vercel plan supports protected-deployment sharing. Do not replace it with a public production deployment.

## Security and beta checklist

- Confirm the target deployment says **Preview**, not Production.
- Confirm `/api/analyze-food` returns `403 PRODUCTION_AI_DISABLED` under `VERCEL_ENV=production`.
- Confirm a request without a valid session returns `401 BETA_SESSION_REQUIRED`.
- Confirm the initial HTTP request and platform access logs contain no `invite` token.
- Confirm the browser removes `#invite=…` before the redemption request begins.
- Confirm a redeemed invitation cannot create a session in a second browser.
- Confirm invalid invitation attempts are durably limited to 10 per 15-minute window per source address.
- Confirm analysis 11 for one tester returns `429 BETA_DAILY_LIMIT`.
- Confirm the configured global cap returns `429 BETA_GLOBAL_LIMIT` before OpenAI is called.
- Confirm a Redis outage returns `503 BETA_STORE_UNAVAILABLE` before OpenAI is called.
- Confirm cookies are HttpOnly, Secure, SameSite=Lax, and contain no invitation token.
- Confirm the OpenAI and Redis secrets are Preview-only and never appear in browser JavaScript.
- Confirm photos are sent with `store: false`; only usage metadata is logged.
- Revoke a tester by removing their hash and redeploying the preview. Existing sessions for that tester then fail validation.

When the beta ends, revoke the Shareable Link, disable the Preview deployment, rotate the session secret and OpenAI key if needed, and remove the Redis integration after retaining any required usage records.
