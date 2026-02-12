import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises', () => {
  const store = {};
  return {
    default: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockImplementation(async (path) => {
        if (store[path]) return;
        throw new Error('ENOENT');
      }),
      readFile: vi.fn().mockImplementation(async (path) => {
        if (store[path] !== undefined) return store[path];
        throw new Error('ENOENT');
      }),
      writeFile: vi.fn().mockImplementation(async (path, content) => {
        store[path] = content;
      }),
    },
    __store: store,
  };
});

import fs from 'fs/promises';
import { PromptManager } from './prompt-manager.js';

// Access the backing store for test assertions
const { __store: store } = await import('fs/promises');

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(store)) delete store[key];
});

describe('PromptManager', () => {
  const configDir = '/test';
  let pm;

  beforeEach(() => {
    pm = new PromptManager(configDir);
  });

  describe('initialize', () => {
    it('creates all prompt files when none exist', async () => {
      await pm.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith('/test/prompts', { recursive: true });
      // Should have written base.md, quality.md, patterns.json
      expect(fs.writeFile).toHaveBeenCalledTimes(3);
      expect(store['/test/prompts/patterns.json']).toContain('"patterns"');
    });

    it('skips existing files', async () => {
      store['/test/prompts/base.md'] = 'existing base';
      store['/test/prompts/quality.md'] = 'existing quality';
      store['/test/prompts/patterns.json'] = '{"patterns":[]}';

      await pm.initialize();

      // access succeeds for all 3 → no writeFile calls
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('getSystemPrompt', () => {
    it('combines base and quality prompts without patterns', async () => {
      store['/test/prompts/base.md'] = '# Base';
      store['/test/prompts/quality.md'] = '## Quality';
      store['/test/prompts/patterns.json'] = '{"patterns":[]}';

      const prompt = await pm.getSystemPrompt();
      expect(prompt).toContain('# Base');
      expect(prompt).toContain('## Quality');
      expect(prompt).not.toContain('LEARNED PATTERNS');
    });

    it('includes learned patterns when present', async () => {
      store['/test/prompts/base.md'] = '# Base';
      store['/test/prompts/quality.md'] = '## Quality';
      store['/test/prompts/patterns.json'] = JSON.stringify({
        patterns: [
          { description: 'Use numbers', impact: 2.1, sampleSize: 10 },
        ],
      });

      const prompt = await pm.getSystemPrompt();
      expect(prompt).toContain('LEARNED PATTERNS');
      expect(prompt).toContain('Use numbers');
      expect(prompt).toContain('2.1x CTR');
    });

  });

  describe('addPattern', () => {
    it('appends pattern with timestamp', async () => {
      store['/test/prompts/patterns.json'] = '{"patterns":[]}';

      await pm.addPattern({ description: 'Start with verbs', impact: 1.5 });

      const written = JSON.parse(store['/test/prompts/patterns.json']);
      expect(written.patterns).toHaveLength(1);
      expect(written.patterns[0].description).toBe('Start with verbs');
      expect(written.patterns[0].addedAt).toBeTruthy();
    });
  });

  describe('updateQualityPrompt', () => {
    it('backs up old content and writes new', async () => {
      store['/test/prompts/quality.md'] = 'old quality content';

      await pm.updateQualityPrompt('new quality content');

      // Old content backed up with date-stamped name
      const backupCalls = fs.writeFile.mock.calls.filter(
        ([p]) => p.includes('quality-') && p.endsWith('.md')
      );
      expect(backupCalls).toHaveLength(1);
      expect(backupCalls[0][1]).toBe('old quality content');

      // New content written
      expect(store['/test/prompts/quality.md']).toBe('new quality content');
    });
  });
});
