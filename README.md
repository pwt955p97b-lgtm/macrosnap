# MacroSnap

A mobile-friendly nutrition tracking app that uses AI to estimate calories and macronutrients from food photos.

## Local development

```bash
npm ci
npm run dev
```

The dashboard and manual meal diary work without external services.

## Private Phase 2 food analysis

Food-photo analysis uses OpenAI's Responses API with `gpt-6-luna`. It is disabled by default and must remain disabled in public environments until user authentication and authorization are implemented.

Copy `.env.example` to `.env.local` for private development, set `OPENAI_API_KEY`, and set `MACROSNAP_AI_ENABLED=true`. The key is read only by the server route and must never use a `NEXT_PUBLIC_` variable. The route refuses every production request until real account access controls are added; enabling the development flag does not remove that production lock.

The route accepts JPEG, PNG, and WebP files up to 6 MB. It checks file signatures, enforces a small per-instance request limit, deduplicates concurrent uploads, and caches identical images for 30 minutes. These in-memory controls reduce accidental use but do not replace a shared production rate limiter or authentication.

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
