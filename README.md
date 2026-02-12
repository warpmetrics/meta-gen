# @warpmetrics/meta-gen

Self-improving meta description generator that learns from Google Search Console data.

## Installation

```bash
npm install -g @warpmetrics/meta-gen
```

## Quick Start

```bash
# Authenticate with Google Search Console
meta-gen auth

# Analyze current performance
meta-gen analyze

# Generate improved descriptions
meta-gen generate --threshold 3.0 --max 50

# After 7 days, collect performance feedback
meta-gen feedback --min-days 7

# Run self-improvement analysis
meta-gen improve
```

## Features

- Connects to Google Search Console for CTR data
- Generates SEO-optimized meta descriptions using GPT-4
- Tracks all generations in WarpMetrics
- Learns from high-performing descriptions
- Self-improves automatically based on real data

## Commands

### `meta-gen auth`

Authenticate with Google Search Console via OAuth.

```bash
meta-gen auth
```

Saves credentials to `.gsc-credentials.json` (add to .gitignore).

### `meta-gen analyze`

View current meta description performance from GSC.

```bash
meta-gen analyze [options]

Options:
  --min-impressions <number>  Minimum impressions to consider (default: 100)
  --days <number>             Days of data to analyze (default: 30)
```

### `meta-gen generate`

Generate improved meta descriptions for low-CTR pages.

```bash
meta-gen generate [options]

Options:
  --threshold <number>  CTR threshold in % (default: 3.0)
  --max <number>        Maximum pages to generate (default: 50)
  --output <path>       Output file path (default: ./src/meta.json)
```

Saves results to `meta.json`:

```json
{
  "/page-url": {
    "title": "Page Title (50-60 chars)",
    "description": "Meta description (140-160 chars)",
    "generatedAt": "2024-02-11T10:30:00Z",
    "runId": "wm_run_abc123",
    "baseline": {
      "ctr": 0.023,
      "impressions": 12000
    }
  }
}
```

### `meta-gen feedback`

Collect performance feedback from Google Search Console.

```bash
meta-gen feedback [options]

Options:
  --min-days <number>  Minimum days since generation (default: 7)
  --input <path>       Meta JSON file path (default: ./src/meta.json)
```

This command:
- Reads `meta.json` to find pages generated 7+ days ago
- Fetches current CTR from Google Search Console
- Compares against baseline and records outcomes in WarpMetrics
- Creates "High CTR" outcomes for 20%+ improvements
- Tracks all feedback in a "Performance Tracking" run

Run this daily via cron or GitHub Actions after initial generation.

### `meta-gen improve`

Run self-improvement analysis based on performance data.

```bash
meta-gen improve [options]

Options:
  --min-samples <number>  Minimum high-CTR samples needed (default: 5)
```

Requires at least 5 high-performing descriptions (20%+ CTR increase) from feedback data.

## Setup

### 1. Google Search Console Credentials

Create OAuth credentials:

1. Go to https://console.cloud.google.com/
2. Create/select a project
3. Enable "Google Search Console API"
4. Create OAuth 2.0 credentials (Web application)
5. Add redirect URI: `http://localhost:3000/oauth/callback`
6. Save Client ID and Client Secret

### 2. Environment Variables

```bash
# Required for generation
OPENAI_API_KEY=sk-proj-...
WARPMETRICS_API_KEY=wm_live_...

# Required for authentication
GSC_CLIENT_ID=xxx.apps.googleusercontent.com
GSC_CLIENT_SECRET=xxx
```

### 3. Configuration

Create `meta-gen.config.json`:

```json
{
  "domain": "yoursite.com",
  "siteUrl": "sc-domain:yoursite.com"
}
```

For URL prefix properties, use: `"siteUrl": "https://yoursite.com"`

## React Integration

```jsx
import { useEffect } from 'react';
import metaTags from './meta.json';

function App() {
  const location = useLocation();

  useEffect(() => {
    const meta = metaTags[location.pathname];
    if (!meta) return;

    document.title = meta.title;

    const tags = [
      ['name', 'description', meta.description],
      ['property', 'og:title', meta.title],
      ['property', 'og:description', meta.description],
    ];

    tags.forEach(([attr, value, content]) => {
      let tag = document.querySelector(`meta[${attr}="${value}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, value);
        document.head.appendChild(tag);
      }
      tag.content = content;
    });
  }, [location.pathname]);

  return <div>...</div>;
}
```

## Self-Improvement Loop

1. **Generate** descriptions and track in WarpMetrics
2. **Deploy** to production
3. **Wait 7 days** for CTR data to accumulate
4. **Collect feedback** with `meta-gen feedback`
5. **Analyze patterns** with `meta-gen improve`
6. **Update prompts** automatically based on learnings
7. **Generate again** - next batch automatically links to improvements
8. **Repeat** - continuous learning loop

### Complete Example

```bash
# Week 1: Generate descriptions
meta-gen generate --threshold 3.0 --max 50
# Deploy to production
git add src/meta.json
git commit -m "chore: improve meta descriptions"
git push

# Week 2-3: Wait for data (7+ days)

# Week 3: Collect feedback
meta-gen feedback --min-days 7
# Output: "5 high performers found"

# Week 3: Run improvement analysis
meta-gen improve
# Learns patterns from high-CTR descriptions
# Updates prompts/quality.md automatically
# Creates "Apply Improvements" act

# Week 4: Generate next batch
meta-gen generate --threshold 3.0 --max 50
# Automatically links to previous improvement
# Uses learned patterns in prompts
# Output: "Linked to improvement analysis from 2/15/2026"
```

The WarpMetrics flow shows:
```
Generation Run 1
  └─ outcomes: Generated (50 pages)
        ↓
Performance Tracking Run (7 days later)
  └─ outcomes: High CTR (5 pages), Improved (30 pages), No Improvement (15 pages)
        ↓
Self Improvement Analysis Run
  ├─ outcome: Improvement Applied (learned 3 patterns)
  └─ act: Apply Improvements
        ↓
Generation Run 2 (linked to act)
  └─ outcomes: Generated (50 pages)
```

## GitHub Actions

### Weekly Generation

```yaml
name: Generate Meta Descriptions
on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - name: Generate
        env:
          GSC_CREDENTIALS: ${{ secrets.GSC_CREDENTIALS }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          WARPMETRICS_API_KEY: ${{ secrets.WARPMETRICS_API_KEY }}
          GSC_CLIENT_ID: ${{ secrets.GSC_CLIENT_ID }}
          GSC_CLIENT_SECRET: ${{ secrets.GSC_CLIENT_SECRET }}
        run: |
          echo "$GSC_CREDENTIALS" > .gsc-credentials.json
          npx @warpmetrics/meta-gen generate --threshold 3.0 --max 50
      - uses: peter-evans/create-pull-request@v5
        with:
          commit-message: 'chore: improve meta descriptions'
          title: 'SEO: Improve meta descriptions'
```

### Daily Feedback

```yaml
name: Collect Feedback
on:
  schedule:
    - cron: '0 3 * * *'  # Daily at 3am
  workflow_dispatch:

jobs:
  feedback:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Collect Feedback
        env:
          GSC_CREDENTIALS: ${{ secrets.GSC_CREDENTIALS }}
          WARPMETRICS_API_KEY: ${{ secrets.WARPMETRICS_API_KEY }}
          GSC_CLIENT_ID: ${{ secrets.GSC_CLIENT_ID }}
          GSC_CLIENT_SECRET: ${{ secrets.GSC_CLIENT_SECRET }}
        run: |
          echo "$GSC_CREDENTIALS" > .gsc-credentials.json
          npx @warpmetrics/meta-gen feedback --min-days 7 --input ./src/meta.json
```

## Prompt System

Two-tier prompt structure:

- `prompts/base.md` - Unchanging constraints (output format, length limits)
- `prompts/quality.md` - Tunable guidelines (learned from data)
- `prompts/patterns.json` - Learned patterns from high-CTR descriptions

Only `quality.md` and `patterns.json` are modified by the improvement process.

## API

### Core Classes

```javascript
import {
  GSCClient,
  MetaGenerator,
  PromptManager,
  PerformanceTracker,
  Improver
} from '@warpmetrics/meta-gen';
```

See source code for detailed API documentation.

## Publishing

```bash
# Run tests
npm test

# Create release (auto-publishes to npm)
npm run release:patch  # 0.1.0 -> 0.1.1
npm run release:minor  # 0.1.0 -> 0.2.0
```

Publishes via GitHub Actions on git tags (v*).

## License

MIT
