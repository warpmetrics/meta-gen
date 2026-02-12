import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@warpmetrics/warp', () => ({
  outcome: vi.fn(),
}));

import { outcome } from '@warpmetrics/warp';
import { PerformanceTracker } from './tracker.js';

function makeGscClient(perfByPage = {}) {
  return {
    getPagePerformanceByPage: vi.fn().mockImplementation(
      async (_siteUrl, fullUrl) => perfByPage[fullUrl] ?? null
    ),
  };
}

const grp = 'test-grp';
const siteUrl = 'sc-domain:example.com';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PerformanceTracker', () => {
  it('returns zeros when no pages are eligible', async () => {
    const tracker = new PerformanceTracker(makeGscClient());

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/old': { failed: true },
      '/new': { generatedAt: new Date().toISOString(), runId: 'r1' }, // too recent
    }, 7);

    expect(result).toEqual({ tracked: 0, highPerformers: 0 });
  });

  it('filters out failed entries', async () => {
    const tracker = new PerformanceTracker(makeGscClient());
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': { failed: true, generatedAt: oldDate, runId: 'r1' },
    }, 7);

    expect(result).toEqual({ tracked: 0, highPerformers: 0 });
  });

  it('classifies high CTR with baseline (>20% improvement)', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({
      'https://example.com/page': { ctr: 0.05, impressions: 100 },
    });
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': {
        generatedAt: oldDate,
        runId: 'r1',
        title: 'Test',
        description: 'Desc',
        baseline: { ctr: 0.03 },
      },
    }, 7);

    expect(result).toEqual({ tracked: 1, highPerformers: 1 });
    expect(outcome).toHaveBeenCalledWith(grp, 'High CTR', expect.objectContaining({ page: '/page' }));
  });

  it('classifies improved with baseline (0-20% improvement)', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({
      'https://example.com/page': { ctr: 0.035, impressions: 100 },
    });
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': {
        generatedAt: oldDate,
        runId: 'r1',
        title: 'Test',
        description: 'Desc',
        baseline: { ctr: 0.03 },
      },
    }, 7);

    expect(result).toEqual({ tracked: 1, highPerformers: 0 });
    expect(outcome).toHaveBeenCalledWith(grp, 'Improved', expect.objectContaining({ page: '/page' }));
  });

  it('classifies no improvement with baseline', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({
      'https://example.com/page': { ctr: 0.02, impressions: 100 },
    });
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': {
        generatedAt: oldDate,
        runId: 'r1',
        title: 'Test',
        description: 'Desc',
        baseline: { ctr: 0.03 },
      },
    }, 7);

    expect(result).toEqual({ tracked: 1, highPerformers: 0 });
    expect(outcome).toHaveBeenCalledWith(grp, 'No Improvement', expect.objectContaining({ page: '/page' }));
  });

  it('classifies by absolute CTR when no baseline (>=5%)', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({
      'https://example.com/page': { ctr: 0.06, impressions: 50 },
    });
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': {
        generatedAt: oldDate,
        runId: 'r1',
        title: 'Test',
        description: 'Desc',
      },
    }, 7);

    expect(result).toEqual({ tracked: 1, highPerformers: 1 });
    expect(outcome).toHaveBeenCalledWith(grp, 'High CTR', expect.objectContaining({ page: '/page' }));
  });

  it('classifies by absolute CTR when no baseline (3-5% → Improved)', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({
      'https://example.com/page': { ctr: 0.04, impressions: 50 },
    });
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': {
        generatedAt: oldDate,
        runId: 'r1',
        title: 'Test',
        description: 'Desc',
      },
    }, 7);

    expect(result).toEqual({ tracked: 1, highPerformers: 0 });
    expect(outcome).toHaveBeenCalledWith(grp, 'Improved', expect.objectContaining({ page: '/page' }));
  });

  it('classifies by absolute CTR when no baseline (<3% → No Improvement)', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({
      'https://example.com/page': { ctr: 0.02, impressions: 50 },
    });
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': {
        generatedAt: oldDate,
        runId: 'r1',
        title: 'Test',
        description: 'Desc',
      },
    }, 7);

    expect(result).toEqual({ tracked: 1, highPerformers: 0 });
    expect(outcome).toHaveBeenCalledWith(grp, 'No Improvement', expect.objectContaining({ page: '/page' }));
  });

  it('records insufficient data when GSC returns null', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({}); // returns null for all pages
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': { generatedAt: oldDate, runId: 'r1' },
    }, 7);

    expect(result).toEqual({ tracked: 0, highPerformers: 0 });
    expect(outcome).toHaveBeenCalledWith(grp, 'Insufficient Data', expect.objectContaining({
      page: '/page',
      reason: 'No data from GSC',
    }));
  });

  it('records insufficient data for low impressions', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const gsc = makeGscClient({
      'https://example.com/page': { ctr: 0.05, impressions: 5 },
    });
    const tracker = new PerformanceTracker(gsc);

    const result = await tracker.trackPerformance(grp, siteUrl, {
      '/page': { generatedAt: oldDate, runId: 'r1' },
    }, 7);

    expect(result).toEqual({ tracked: 0, highPerformers: 0 });
    expect(outcome).toHaveBeenCalledWith(grp, 'Insufficient Data', expect.objectContaining({
      reason: 'Low impressions',
    }));
  });
});
