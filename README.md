# MacroSnap

A mobile-friendly nutrition tracking app that uses AI to estimate calories and macronutrients from food photos.

## Local development

```bash
npm ci
npm run dev
```

The dashboard and manual meal diary work without external services.

## Private Phase 2 food analysis

Food-photo analysis uses OpenAI's Responses API with `gpt-6-luna`. It is disabled by default. Public Vercel production deployments are hard-disabled; the private beta can run only in local development or a protected Vercel Preview deployment.

Copy `.env.example` to `.env.local` for private development, set `OPENAI_API_KEY`, and set `MACROSNAP_AI_ENABLED=true`. The key is read only by the server route and must never use a `NEXT_PUBLIC_` variable. Enabling the development flag does not remove the production lock.

The route accepts JPEG, PNG, and WebP files up to 6 MB. It checks file signatures, enforces a small per-instance burst limit, deduplicates concurrent uploads, and caches identical images for 30 minutes.

## Private beta

The beta adds single-use individual invitation links, signed HttpOnly sessions, durable atomic usage counters, a hard limit of 10 AI analyses per tester per UTC day, and a configurable global daily cap. Invitation tokens use URL fragments so they never reach HTTP access logs and are removed from the address bar before redemption. Redis credentials and all other secrets stay server-side. If the session, durable counter store, or OpenAI configuration is unavailable, beta AI requests fail closed.

See [docs/private-beta-vercel.md](docs/private-beta-vercel.md) for code generation, environment variables, Vercel Shareable Links, and the release checklist. No Redis database is provisioned by this repository; choose a no-cost plan and do not enable billing without approval.

Token usage is recorded for each OpenAI request. Set the current input and output rates in `.env.local` to calculate estimated cost:

```bash
OPENAI_GPT6_LUNA_INPUT_USD_PER_MILLION=
OPENAI_GPT6_LUNA_OUTPUT_USD_PER_MILLION=
```

Before opening a pull request, run:

```bash
npm test
npm run lint
npm run build
```
