import { describe, it, expect, vi } from 'vitest';

vi.mock('@warpmetrics/warp', () => ({
  outcome: vi.fn(),
  call: vi.fn(),
}));

import { lengthValidator, qualityValidator } from './validators.js';

describe('lengthValidator', () => {
  const ctx = { target: 'grp' };
  const page = { url: 'https://example.com/page' };

  it('passes for description within default bounds', async () => {
    const validate = lengthValidator();
    const generated = { description: 'A'.repeat(150) };
    const result = await validate(generated, page, ctx);
    expect(result.pass).toBe(true);
  });

  it('fails for description too short', async () => {
    const validate = lengthValidator();
    const generated = { description: 'A'.repeat(100) };
    const result = await validate(generated, page, ctx);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/100 chars/);
  });

  it('fails for description too long', async () => {
    const validate = lengthValidator();
    const generated = { description: 'A'.repeat(200) };
    const result = await validate(generated, page, ctx);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/200 chars/);
  });

  it('respects custom bounds', async () => {
    const validate = lengthValidator({ min: 50, max: 80 });
    const short = { description: 'A'.repeat(40) };
    const ok = { description: 'A'.repeat(60) };
    const long = { description: 'A'.repeat(90) };

    expect((await validate(short, page, ctx)).pass).toBe(false);
    expect((await validate(ok, page, ctx)).pass).toBe(true);
    expect((await validate(long, page, ctx)).pass).toBe(false);
  });
});

describe('qualityValidator', () => {
  const ctx = { target: 'grp' };
  const page = { url: 'https://example.com/page', currentTitle: 'Test Page' };
  const generated = { title: 'Test Title', description: 'A'.repeat(150) };

  function mockOpenAI(content) {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(content) } }],
          }),
        },
      },
    };
  }

  it('passes when score meets threshold', async () => {
    const openai = mockOpenAI({ score: 8, feedback: 'Great description' });
    const validate = qualityValidator(openai);
    const result = await validate(generated, page, ctx);
    expect(result.pass).toBe(true);
    expect(result.meta.qualityScore).toBe(8);
    expect(result.meta.qualityFeedback).toBe('Great description');
  });

  it('fails when score below threshold', async () => {
    const openai = mockOpenAI({ score: 4, feedback: 'Too generic' });
    const validate = qualityValidator(openai);
    const result = await validate(generated, page, ctx);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/4\/10/);
  });

  it('respects custom threshold', async () => {
    const openai = mockOpenAI({ score: 6, feedback: 'Ok' });
    const validate = qualityValidator(openai, { threshold: 5 });
    const result = await validate(generated, page, ctx);
    expect(result.pass).toBe(true);
  });

});
