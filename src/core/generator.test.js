import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@warpmetrics/warp', () => ({
  warp: (obj) => obj,
  call: vi.fn(),
  outcome: vi.fn(),
  group: vi.fn((parent, label) => `${parent}-${label}`),
}));

import { outcome } from '@warpmetrics/warp';
import { generate, buildUserPrompt } from './generator.js';

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

const mockPromptManager = {
  getSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generate', () => {
  it('returns result with no failures on first attempt success', async () => {
    const goodResult = { title: 'Great Title', description: 'A'.repeat(150) };
    const openai = mockOpenAI(goodResult);
    const passValidator = async () => ({ pass: true });

    const { results, failures } = await generate(openai, mockPromptManager, grp, [page], {
      validators: [passValidator],
      maxRetries: 3,
    });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Great Title');
    expect(results[0].url).toBe('https://example.com/page');
    expect(failures).toHaveLength(0);
    const pageGrp = `${grp}-page`;
    expect(outcome).toHaveBeenCalledWith(pageGrp, 'Generated', expect.objectContaining({ page: page.url }));
  });

  it('feeds failure reason back and succeeds on retry', async () => {
    const bad = { title: 'Bad', description: 'Short' };
    const good = { title: 'Good Title', description: 'A'.repeat(150) };
    const openai = mockOpenAI(bad, good);

    const validator = async (generated) => {
      if (generated.description.length < 100) {
        return { pass: false, reason: 'Too short' };
      }
      return { pass: true };
    };

    const { results, failures } = await generate(openai, mockPromptManager, grp, [page], {
      validators: [validator],
      maxRetries: 3,
    });

    expect(results).toHaveLength(1);
    expect(failures).toHaveLength(0);
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2);

    // Verify retry includes rejection history
    const retryCall = openai.chat.completions.create.mock.calls[1][0];
    const retryMsg = retryCall.messages.find(m => m.content?.includes('REJECTED'));
    expect(retryMsg.content).toContain('Too short');
    expect(retryMsg.content).toContain('fundamentally different');

    // No redundant 'Validation Failed' outcome — validators record their own outcomes
    const pageGrp = `${grp}-page`;
    expect(outcome).not.toHaveBeenCalledWith(pageGrp, 'Validation Failed', expect.anything());
  });

  it('records Generation Failed when max retries exhausted', async () => {
    const bad = { title: 'Bad', description: 'Short' };
    const openai = mockOpenAI(bad);
    const failValidator = async () => ({ pass: false, reason: 'Always fails' });

    const { results, failures } = await generate(openai, mockPromptManager, grp, [page], {
      validators: [failValidator],
      maxRetries: 2,
    });

    expect(results).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].url).toBe(page.url);
    expect(failures[0].attempts).toBe(2);
    const pageGrp = `${grp}-page`;
    expect(outcome).toHaveBeenCalledWith(pageGrp, 'Generation Failed', expect.objectContaining({
      page: page.url,
      attempts: 2,
    }));
  });

  it('catches openai errors and records Generation Error', async () => {
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit')),
        },
      },
    };

    const { results, failures } = await generate(openai, mockPromptManager, grp, [page], {
      validators: [],
      maxRetries: 3,
    });

    expect(results).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].lastReason).toBe('API rate limit');
    const pageGrp = `${grp}-page`;
    expect(outcome).toHaveBeenCalledWith(pageGrp, 'Generation Error', expect.objectContaining({
      error: 'API rate limit',
    }));
  });
});

describe('buildUserPrompt', () => {
  it('includes content when provided', () => {
    const prompt = buildUserPrompt({ ...page, content: 'Page body text' });
    expect(prompt).toContain('Page body text');
  });

  it('omits content section when not provided', () => {
    const prompt = buildUserPrompt(page);
    expect(prompt).not.toContain('Page Content:');
  });
});
