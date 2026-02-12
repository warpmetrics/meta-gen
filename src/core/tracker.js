// Tracks performance and records outcomes
import { run, outcome, flush } from '@warpmetrics/warp';

export class PerformanceTracker {
  constructor(gscClient, warpmetricsApiKey) {
    this.gscClient = gscClient;
    this.warpmetricsApiKey = warpmetricsApiKey;
  }

  async trackPerformance(siteUrl, generationRunId, pages, daysAgo = 7) {
    // Create a tracking run that links back to the generation run
    const trackingRun = run('Performance Tracking', {
      generationRunId,
      pageCount: pages.length,
      daysAfterGeneration: daysAgo
    });

    // Fetch runs from WarpMetrics to find pages that were generated
    const response = await fetch(
      `https://api.warpmetrics.com/v1/runs/${generationRunId}`,
      {
        headers: { 'Authorization': `Bearer ${this.warpmetricsApiKey}` }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch run: ${response.statusText}`);
    }

    const generationRun = await response.json();

    // Build map of pages with their descriptions
    const pageMap = new Map();
    for (const page of pages) {
      pageMap.set(page.url, {
        description: page.description,
        title: page.title
      });
    }

    const generatedPages = generationRun.outcomes
      .filter(o => o.name === 'Generated')
      .map(o => {
        const url = o.opts?.page;
        const meta = pageMap.get(url);
        return {
          url,
          baselineCTR: o.opts?.currentCTR,
          description: meta?.description,
          title: meta?.title,
          outcomeId: o.id
        };
      })
      .filter(p => p.url && p.baselineCTR !== undefined && p.description);

    // Get current performance from GSC
    const startDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    let tracked = 0;
    let highPerformers = 0;

    for (const page of generatedPages) {
      let perf;
      let currentCTR;
      let improvement;

      // Test mode: simulate GSC data with realistic improvements
      if (process.env.TEST_MODE === 'true') {
        const rand = Math.random();
        const improvementFactor = rand < 0.2 ? (1 + Math.random() * 0.5) : // 20% chance: 0-50% improvement (high performers)
                                   rand < 0.7 ? (1 + Math.random() * 0.15) : // 50% chance: 0-15% improvement
                                   (1 - Math.random() * 0.1); // 30% chance: 0-10% decline

        currentCTR = page.baselineCTR * improvementFactor;
        improvement = (currentCTR - page.baselineCTR) / page.baselineCTR;

        perf = {
          ctr: currentCTR,
          impressions: Math.floor(Math.random() * 15000) + 5000,
          clicks: Math.floor(currentCTR * (Math.random() * 15000 + 5000))
        };
      } else {
        // Production mode: fetch real GSC data
        perf = await this.gscClient.getPagePerformanceByPage(
          siteUrl,
          page.url,
          startDate,
          endDate
        );

        if (!perf || perf.impressions < 10) {
          outcome(trackingRun, 'Insufficient Data', {
            page: page.url,
            generationRunId,
            reason: perf ? 'Low impressions' : 'No data from GSC'
          });
          continue;
        }

        currentCTR = perf.ctr;
        improvement = (currentCTR - page.baselineCTR) / page.baselineCTR;
      }

      // Record outcome in THIS tracking run, with reference back to generation run
      if (improvement > 0.2) {
        outcome(trackingRun, 'High CTR', {
          page: page.url,
          title: page.title,
          description: page.description,
          ctr: currentCTR,
          baselineCTR: page.baselineCTR,
          improvement: `+${(improvement * 100).toFixed(0)}%`,
          impressions: perf.impressions,
          generationRunId,
          summary: `${page.url} improved CTR by ${(improvement * 100).toFixed(0)}%`
        });
        highPerformers++;
      } else if (improvement > 0) {
        outcome(trackingRun, 'Improved', {
          page: page.url,
          title: page.title,
          description: page.description,
          ctr: currentCTR,
          baselineCTR: page.baselineCTR,
          improvement: `+${(improvement * 100).toFixed(0)}%`,
          impressions: perf.impressions,
          generationRunId
        });
      } else {
        outcome(trackingRun, 'No Improvement', {
          page: page.url,
          title: page.title,
          description: page.description,
          ctr: currentCTR,
          baselineCTR: page.baselineCTR,
          improvement: `${(improvement * 100).toFixed(0)}%`,
          impressions: perf.impressions,
          generationRunId
        });
      }

      tracked++;
    }

    outcome(trackingRun, 'Tracking Complete', {
      generationRunId,
      pagesTracked: tracked,
      highPerformers,
      successRate: tracked > 0 ? (highPerformers / tracked * 100).toFixed(0) + '%' : '0%'
    });

    await flush();

    return {
      trackingRunId: trackingRun.id,
      tracked,
      highPerformers
    };
  }
}
