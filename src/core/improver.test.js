import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@warpmetrics/warp', () => ({
  warp: (obj) => obj,
  call: vi.fn(),
  outcome: vi.fn(),
}));

import { outcome } from '@warpmetrics/warp';
import { Improver } from './improver.js';

const grp = 'test-grp';

function makeHighCTROutcome(page, i) {
  return {
    opts: {
      page,
      title: `Title ${i}`,
      description: `Description for page ${i} that performs well`,
      ctr: 0.06,
      improvement: '+25%',
      baselineCTR: 0.04,
    },
  };
}

function makeMockPromptManager() {
  return {
    addPattern: vi.fn().mockResolvedValue(undefined),
    updateQualityPrompt: vi.fn().mockResolvedValue(undefined),
    getSystemPrompt: vi.fn().mockResolvedValue('current system prompt'),
  };
}

function makeMockOpenAI(analysisResponse, improvedPrompt) {
  let callIdx = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => {
          const content = callIdx === 0
            ? JSON.stringify(analysisResponse)
            : improvedPrompt;
          callIdx++;
          return { choices: [{ message: { content } }] };
        }),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Improver', () => {
  describe('analyze — sufficient data', () => {
    it('stores patterns and updates quality prompt', async () => {
      const highCTRData = Array.from({ length: 6 }, (_, i) => makeHighCTROutcome(`/page-${i}`, i));
      const noImprovementData = [{ opts: { page: '/bad', description: 'Bad desc', ctr: 0.01 } }];
      const genFailureData = [];

      // Mock global fetch for WarpMetrics API
      let fetchCallIdx = 0;
      const responses = [
        { data: highCTRData, pagination: { hasMore: false } },
        { data: noImprovementData, pagination: { hasMore: false } },
        { data: genFailureData, pagination: { hasMore: false } },
      ];

      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => responses[fetchCallIdx++],
      })));

      const analysisResult = {
        patterns: [
          { description: 'Use action verbs', example: 'Discover', impact: 2.1, confidence: 'high' },
          { description: 'Include numbers', example: '5 tools', impact: 1.8, confidence: 'medium' },
        ],
        improvements: 'Add more specificity',
        failureInsights: [],
      };

      const pm = makeMockPromptManager();
      const openai = makeMockOpenAI(analysisResult, 'updated prompt content');

      const improver = new Improver('wm-key', 'oai-key', pm);
      improver.openai = openai;

      const result = await improver.analyze(grp, 'example.com');

      expect(result).toEqual({ patternsLearned: 2 });
      expect(pm.addPattern).toHaveBeenCalledTimes(2);
      expect(pm.addPattern).toHaveBeenCalledWith(expect.objectContaining({
        description: 'Use action verbs',
        sampleSize: 6,
      }));
      expect(pm.updateQualityPrompt).toHaveBeenCalledWith('updated prompt content');
      expect(outcome).toHaveBeenCalledWith(grp, 'Patterns Learned', expect.objectContaining({
        count: 2,
      }));
    });
  });

  describe('analyze — insufficient data', () => {
    it('returns null when fewer than 5 high CTR outcomes', async () => {
      const highCTRData = Array.from({ length: 3 }, (_, i) => makeHighCTROutcome(`/page-${i}`, i));

      let fetchCallIdx = 0;
      const responses = [
        { data: highCTRData, pagination: { hasMore: false } },
        { data: [], pagination: { hasMore: false } },
        { data: [], pagination: { hasMore: false } },
      ];

      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => responses[fetchCallIdx++],
      })));

      const pm = makeMockPromptManager();
      const improver = new Improver('wm-key', 'oai-key', pm);
      improver.openai = makeMockOpenAI({}, '');

      const result = await improver.analyze(grp, 'example.com');

      expect(result).toBeNull();
      expect(outcome).toHaveBeenCalledWith(grp, 'Insufficient Data', expect.objectContaining({
        highPerformers: 3,
        needed: 5,
      }));
    });
  });

  describe('fetchOutcomes — pagination', () => {
    it('fetches all pages when hasMore is true', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => makeHighCTROutcome(`/p1-${i}`, i));
      const page2 = Array.from({ length: 20 }, (_, i) => makeHighCTROutcome(`/p2-${i}`, i));

      let fetchCallCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
        fetchCallCount++;
        const isFirstPage = url.includes('offset=0');
        return {
          ok: true,
          json: async () => isFirstPage
            ? { data: page1, pagination: { hasMore: true } }
            : { data: page2, pagination: { hasMore: false } },
        };
      }));

      const improver = new Improver('wm-key', 'oai-key', makeMockPromptManager());
      const results = await improver.fetchOutcomes('High CTR', '2025-01-01');

      expect(results).toHaveLength(120);
      expect(fetchCallCount).toBe(2);
    });
  });

  describe('analyze — generation failures included', () => {
    it('includes failure insights in analysis prompt', async () => {
      const highCTRData = Array.from({ length: 6 }, (_, i) => makeHighCTROutcome(`/page-${i}`, i));
      const genFailureData = [{
        opts: { page: '/fail', attempts: 3, lastReason: 'Too long', history: [] },
      }];

      let fetchCallIdx = 0;
      const responses = [
        { data: highCTRData, pagination: { hasMore: false } },
        { data: [], pagination: { hasMore: false } },
        { data: genFailureData, pagination: { hasMore: false } },
      ];

      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => responses[fetchCallIdx++],
      })));

      const analysisResult = {
        patterns: [{ description: 'Pattern', example: 'Ex', impact: 1.5, confidence: 'high' }],
        improvements: 'Fix generation',
        failureInsights: ['Pages with long content fail'],
      };

      const pm = makeMockPromptManager();
      const openai = makeMockOpenAI(analysisResult, 'updated');

      const improver = new Improver('wm-key', 'oai-key', pm);
      improver.openai = openai;

      await improver.analyze(grp, 'example.com');

      // Verify the analysis LLM call included generation failures
      const analysisCall = openai.chat.completions.create.mock.calls[0];
      const prompt = analysisCall[0].messages[0].content;
      expect(prompt).toContain('GENERATION FAILURES');
      expect(prompt).toContain('Too long');

      expect(outcome).toHaveBeenCalledWith(grp, 'Patterns Learned', expect.objectContaining({
        generationFailures: 1,
      }));
    });
  });
});
