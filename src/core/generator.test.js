import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@warpmetrics/warp', () => ({
  warp: (obj) => obj,
  call: vi.fn(),
  outcome: vi.fn(),
}));

import { outcome } from '@warpmetrics/warp';
import { MetaGenerator } from './generator.js';

function mockOpenAI(...responses) {
  let idx = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => {
          const content = responses[idx] ?? responses[responses.length - 1];
          idx++;
          return {
            choices: [{ message: { content: JSON.stringify(content) } }],
          };
        }),
      },
    },
  };
}

const grp = 'test-grp';
const page = {
  url: 'https://example.com/page',
  currentTitle: 'Test Page',
  currentDescription: 'Old desc',
  ctr: 0.02,
  impressions: 1000,
};

function makeGenerator(openaiMock) {
  const promptManager = {
    getSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
  };
  const gen = new MetaGenerator('fake-key', 'fake-wm-key', promptManager);
  gen.openai = openaiMock;
  return gen;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MetaGenerator', () => {
  describe('generate — success on first attempt', () => {
    it('returns result with no failures', async () => {
      const goodResult = { title: 'Great Title', description: 'A'.repeat(150) };
      const openai = mockOpenAI(goodResult);
      const gen = makeGenerator(openai);

      const passValidator = async () => ({ pass: true });
      const { results, failures } = await gen.generate(grp, [page], {
        validators: [passValidator],
        maxRetries: 3,
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Great Title');
      expect(results[0].url).toBe('https://example.com/page');
      expect(failures).toHaveLength(0);
      expect(outcome).toHaveBeenCalledWith(grp, 'Generated', expect.objectContaining({ page: page.url }));
    });
  });

  describe('generate — validation fail then retry success', () => {
    it('feeds failure reason back and succeeds on retry', async () => {
      const bad = { title: 'Bad', description: 'Short' };
      const good = { title: 'Good Title', description: 'A'.repeat(150) };
      const openai = mockOpenAI(bad, good);
      const gen = makeGenerator(openai);

      let callCount = 0;
      const validator = async (generated) => {
        callCount++;
        if (generated.description.length < 100) {
          return { pass: false, reason: 'Too short' };
        }
        return { pass: true };
      };

      const { results, failures } = await gen.generate(grp, [page], {
        validators: [validator],
        maxRetries: 3,
      });

      expect(results).toHaveLength(1);
      expect(failures).toHaveLength(0);
      // First call fails validation, second succeeds
      expect(openai.chat.completions.create).toHaveBeenCalledTimes(2);
      // Failure reason was fed back
      expect(outcome).toHaveBeenCalledWith(grp, 'Validation Failed', expect.objectContaining({
        reason: 'Too short',
        attempt: 1,
      }));
    });
  });

  describe('generate — max retries exhausted', () => {
    it('records Generation Failed outcome', async () => {
      const bad = { title: 'Bad', description: 'Short' };
      const openai = mockOpenAI(bad);
      const gen = makeGenerator(openai);

      const failValidator = async () => ({ pass: false, reason: 'Always fails' });

      const { results, failures } = await gen.generate(grp, [page], {
        validators: [failValidator],
        maxRetries: 2,
      });

      expect(results).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0].url).toBe(page.url);
      expect(failures[0].attempts).toBe(2);
      expect(outcome).toHaveBeenCalledWith(grp, 'Generation Failed', expect.objectContaining({
        page: page.url,
        attempts: 2,
      }));
    });
  });

  describe('generate — exception handling', () => {
    it('catches openai errors and records Generation Error', async () => {
      const openai = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('API rate limit')),
          },
        },
      };
      const gen = makeGenerator(openai);

      const { results, failures } = await gen.generate(grp, [page], {
        validators: [],
        maxRetries: 3,
      });

      expect(results).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0].lastReason).toBe('API rate limit');
      expect(outcome).toHaveBeenCalledWith(grp, 'Generation Error', expect.objectContaining({
        error: 'API rate limit',
      }));
    });
  });

  describe('buildUserPrompt', () => {
    it('includes content when provided', () => {
      const gen = makeGenerator(mockOpenAI());
      const prompt = gen.buildUserPrompt({ ...page, content: 'Page body text' });
      expect(prompt).toContain('Page body text');
    });

    it('omits content section when not provided', () => {
      const gen = makeGenerator(mockOpenAI());
      const prompt = gen.buildUserPrompt(page);
      expect(prompt).not.toContain('Page Content:');
    });

    it('includes failure history when present', () => {
      const gen = makeGenerator(mockOpenAI());
      const prompt = gen.buildUserPrompt({
        ...page,
        previousFailures: [{ attempt: 1, reason: 'Too short' }],
      });
      expect(prompt).toContain('Previous generation attempts');
      expect(prompt).toContain('Too short');
    });
  });
});
