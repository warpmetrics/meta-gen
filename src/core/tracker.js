// Tracks performance of past generations against GSC data
import { outcome } from '@warpmetrics/warp';

export async function trackPerformance(gscClient, grp, siteUrl, metaJson, minDays = 7) {
  const now = Date.now();

  const eligible = Object.entries(metaJson)
    .filter(([, meta]) => {
      if (meta.failed || !meta.generatedAt || !meta.runId) return false;
      const daysAgo = (now - new Date(meta.generatedAt).getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo >= minDays;
    })
    .map(([pathname, meta]) => ({ pathname, ...meta }));

  if (eligible.length === 0) {
    return { tracked: 0, highPerformers: 0 };
  }

  const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const endDate = new Date().toISOString().split('T')[0];
  const domain = siteUrl.replace('sc-domain:', 'https://');

  const results = await parallel(eligible, 5, async (page) => {
    const fullUrl = `${domain}${page.pathname}`;
    const perf = await gscClient.getPagePerformanceByPage(
      siteUrl, fullUrl, startDate, endDate
    );
    return { page, perf };
  });

  let tracked = 0;
  let highPerformers = 0;

  for (const { page, perf } of results) {
    if (!perf || perf.impressions < 10) {
      outcome(grp, 'Insufficient Data', {
        page: page.pathname,
        reason: perf ? 'Low impressions' : 'No data from GSC',
        generationRunId: page.runId
      });
      continue;
    }

    const currentCTR = perf.ctr;
    const baselineCTR = page.baseline?.ctr || 0;

    const hasBaseline = baselineCTR > 0;
    const improvement = hasBaseline
      ? (currentCTR - baselineCTR) / baselineCTR
      : null;

    const opts = {
      page: page.pathname,
      title: page.title,
      description: page.description,
      ctr: currentCTR,
      baselineCTR,
      improvement: improvement !== null
        ? `${improvement > 0 ? '+' : ''}${(improvement * 100).toFixed(0)}%`
        : 'no baseline',
      impressions: perf.impressions,
      generationRunId: page.runId
    };

    if (!hasBaseline) {
      if (currentCTR >= 0.05) {
        outcome(grp, 'High CTR', opts);
        highPerformers++;
      } else if (currentCTR >= 0.03) {
        outcome(grp, 'Improved', opts);
      } else {
        outcome(grp, 'No Improvement', opts);
      }
    } else if (improvement > 0.2) {
      outcome(grp, 'High CTR', opts);
      highPerformers++;
    } else if (improvement > 0) {
      outcome(grp, 'Improved', opts);
    } else {
      outcome(grp, 'No Improvement', opts);
    }

    tracked++;
  }

  return { tracked, highPerformers };
}

// Run async tasks with a concurrency limit
async function parallel(items, concurrency, fn) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}
