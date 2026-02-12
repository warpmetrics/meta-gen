# @warpmetrics/meta-gen

Not just another SEO tool. Meta descriptions that get better every week, automatically.

## The Problem

Meta descriptions are set-and-forget. You write them once, deploy, and never look at them again. There's no feedback loop — no way to know which descriptions actually drive clicks, and no way to systematically improve them.

## How It Works

meta-gen creates a self-improving flywheel with one command:

```
meta-gen run
  ┌──────────────────────────────────────────┐
  │  1. Feedback — collect CTR data from GSC │
  │  2. Learn — analyze what works, update   │
  │     prompts with learned patterns        │
  │  3. Generate — create new descriptions   │
  │     using improved prompts               │
  └──────────────────────────────────────────┘
         ↓ deploy → wait 7 days → run again
```

Each cycle feeds the next. Descriptions get measurably better over time.

## Quick Start

```bash
# 1. Install
npm install @warpmetrics/meta-gen

# 2. Set up credentials (see Configuration below)
export OPENAI_API_KEY=sk-proj-...
export WARPMETRICS_API_KEY=wm_live_...
export GSC_CLIENT_ID=xxx.apps.googleusercontent.com
export GSC_CLIENT_SECRET=xxx

# 3. Create config
echo '{"domain":"yoursite.com","siteUrl":"sc-domain:yoursite.com"}' > meta-gen.config.json

# 4. Authenticate with Google Search Console
npx meta-gen auth

# 5. Run the flywheel
npx meta-gen run
```

## Commands

### `meta-gen auth`

Authenticate with Google Search Console via OAuth. Opens your browser for Google's consent flow, then saves credentials locally.

```bash
meta-gen auth
```

Credentials are saved to `.gsc-credentials.json`. Add this to `.gitignore`.

### `meta-gen analyze`

View current meta description performance from GSC. Shows average CTR, pages analyzed, and top improvement opportunities.

```bash
meta-gen analyze [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--min-impressions <n>` | `100` | Minimum impressions to include a page |
| `--days <n>` | `30` | Days of data to analyze |

### `meta-gen run`

Run the full flywheel: feedback, learn, generate. This is the main command — run it weekly.

```bash
meta-gen run [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--threshold <n>` | `3.0` | CTR threshold in % — pages below this get improved |
| `--max <n>` | `50` | Maximum pages to generate per run |
| `--min-impressions <n>` | `100` | Minimum impressions required |
| `--min-days <n>` | `7` | Days to wait before collecting feedback |
| `--max-retries <n>` | `3` | Max retries per page on validation failure |
| `--output <path>` | `./src/meta.json` | Output file path |

## How Self-Improvement Works

meta-gen uses a three-file prompt system:

- **`prompts/base.md`** — Static constraints (length limits, output format, tone rules). Never modified.
- **`prompts/quality.md`** — Tunable guidelines that evolve based on what works for your site. Updated automatically when patterns are learned.
- **`prompts/patterns.json`** — Accumulated patterns from high-CTR descriptions, with impact scores and sample sizes.

### What triggers learning

When `meta-gen run` executes the Learn phase, it:

1. Fetches outcomes from the last 30 days via the WarpMetrics API
2. Compares high-CTR descriptions (20%+ improvement) against low performers
3. Uses GPT-4o to identify patterns that correlate with clicks
4. Stores patterns in `patterns.json` and updates `quality.md`

Learning requires at least 5 high-performing descriptions. Until then, the Learn phase is skipped.

### How patterns flow into generation

The system prompt sent to the LLM combines all three files. Learned patterns appear as a `LEARNED PATTERNS` section with impact multipliers and sample sizes, giving the model concrete evidence about what works for your specific site.

## React Integration

Use the `useMeta()` hook to apply generated descriptions at runtime:

```jsx
import { useMeta } from '@warpmetrics/meta-gen/react';
import metaTags from './meta.json';

function App() {
  useMeta(metaTags);
  return <div>...</div>;
}
```

With TanStack Router or any router that provides a pathname:

```jsx
import { useRouterState } from '@tanstack/react-router';

function App() {
  const { location } = useRouterState();
  useMeta(metaTags, location.pathname);
  return <div>...</div>;
}
```

The hook updates `<title>`, `meta[name="description"]`, Open Graph, and Twitter meta tags.

## GitHub Actions

Add this workflow to your project at `.github/workflows/meta-gen.yml`. It runs `meta-gen run` weekly and opens a PR with the updated `src/meta.json`. If nothing changed, no PR is created.

You'll need to add these repository secrets: `GSC_CREDENTIALS` (contents of `.gsc-credentials.json` from `meta-gen auth`), `OPENAI_API_KEY`, `WARPMETRICS_API_KEY`, `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`.

```yaml
name: Meta Gen
on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday 2am
  workflow_dispatch:

jobs:
  meta-gen:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - name: Run meta-gen
        env:
          GSC_CREDENTIALS: ${{ secrets.GSC_CREDENTIALS }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          WARPMETRICS_API_KEY: ${{ secrets.WARPMETRICS_API_KEY }}
          GSC_CLIENT_ID: ${{ secrets.GSC_CLIENT_ID }}
          GSC_CLIENT_SECRET: ${{ secrets.GSC_CLIENT_SECRET }}
        run: |
          echo "$GSC_CREDENTIALS" > .gsc-credentials.json
          npx meta-gen run --threshold 3.0 --max 50
      - uses: peter-evans/create-pull-request@v7
        with:
          commit-message: 'chore: improve meta descriptions'
          title: 'SEO: Improve meta descriptions'
          body: |
            Generated by @warpmetrics/meta-gen.
            Review changes in `src/meta.json`.
```

## Configuration

### `meta-gen.config.json`

```json
{
  "domain": "yoursite.com",
  "siteUrl": "sc-domain:yoursite.com",
  "exclude": ["/blog/*", "/admin/*"]
}
```

| Field | Description |
|-------|-------------|
| `domain` | Your domain name |
| `siteUrl` | GSC property — `sc-domain:yoursite.com` for domain properties, `https://yoursite.com` for URL prefix |
| `exclude` | Optional glob patterns for pages to skip |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key (GPT-4o-mini for generation, GPT-4o for analysis) |
| `WARPMETRICS_API_KEY` | Yes | WarpMetrics API key for tracking |
| `GSC_CLIENT_ID` | Yes | Google OAuth Client ID |
| `GSC_CLIENT_SECRET` | Yes | Google OAuth Client Secret |

### Google Search Console OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the **Google Search Console API**
4. Create **OAuth 2.0 credentials** (Web application type)
5. Add redirect URI: `http://localhost:3456/oauth/callback`
6. Use the Client ID and Client Secret as environment variables

## `meta.json` Format

Output file keyed by pathname:

```json
{
  "/pricing": {
    "title": "Pricing Plans — Start Free, Scale As You Grow",
    "description": "Compare 3 pricing tiers with transparent per-seat costs. Free tier includes 1,000 events. No credit card required to start.",
    "generatedAt": "2026-02-10T10:30:00Z",
    "runId": "wm_run_abc123",
    "baseline": {
      "ctr": 0.023,
      "impressions": 12000
    }
  }
}
```

Failed generations are also tracked so the next run can learn from them:

```json
{
  "/complex-page": {
    "failed": true,
    "failedAt": "2026-02-10T10:30:00Z",
    "runId": "wm_run_abc123",
    "attempts": 3,
    "lastReason": "Quality score 4/10 (needs 7+)",
    "failures": [
      { "attempt": 1, "reason": "Description is 180 chars, must be 140-160" },
      { "attempt": 2, "reason": "Quality score 5/10 (needs 7+)" },
      { "attempt": 3, "reason": "Quality score 4/10 (needs 7+)" }
    ]
  }
}
```

## License

MIT
