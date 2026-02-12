// Generates meta descriptions with validation, retry, and WarpMetrics tracking
import OpenAI from 'openai';
import { warp, call, outcome } from '@warpmetrics/warp';
import { lengthValidator, qualityValidator } from './validators.js';

export class MetaGenerator {
  constructor(apiKey, warpmetricsApiKey, promptManager) {
    this.openai = warp(new OpenAI({ apiKey }), { apiKey: warpmetricsApiKey });
    this.promptManager = promptManager;
  }

  async generate(grp, pages, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const validators = options.validators || [
      lengthValidator(),
      qualityValidator(this.openai)
    ];

    const results = [];
    const failures = [];
    const systemPrompt = await this.promptManager.getSystemPrompt();
    const ctx = { target: grp, openai: this.openai };

    for (const page of pages) {
      try {
        const result = await this.generateWithRetry(
          grp, systemPrompt, page, { maxRetries, validators, ctx }
        );

        if (result.failed) {
          failures.push(result);
        } else {
          results.push({
            url: page.url,
            title: result.title,
            description: result.description,
            currentCTR: page.ctr,
            impressions: page.impressions,
            generatedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        outcome(grp, 'Generation Error', {
          page: page.url,
          error: err.message
        });
        failures.push({
          url: page.url,
          attempts: 0,
          lastReason: err.message,
          history: [{ attempt: 0, reason: err.message }]
        });
      }
    }

    return { results, failures };
  }

  async generateWithRetry(grp, systemPrompt, page, { maxRetries, validators, ctx }) {
    let lastGenerated = null;
    let lastReason = null;
    const failureHistory = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this.buildUserPrompt(page) }
      ];

      // Feed back previous attempt's failure
      if (lastGenerated && lastReason) {
        messages.push(
          { role: 'assistant', content: JSON.stringify(lastGenerated) },
          { role: 'user', content: `That failed validation: ${lastReason}. Fix and regenerate.` }
        );
      }

      const res = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'meta_description',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['title', 'description'],
              additionalProperties: false,
            },
          },
        },
      });

      call(grp, res, { page: page.url, attempt });

      const generated = JSON.parse(res.choices[0].message.content);

      // Run validators sequentially — first failure short-circuits
      let failed = null;
      let mergedMeta = {};

      for (const validate of validators) {
        const result = await validate(generated, page, ctx);
        if (!result.pass) {
          failed = result.reason;
          break;
        }
        if (result.meta) {
          Object.assign(mergedMeta, result.meta);
        }
      }

      // All validators passed
      if (!failed) {
        outcome(grp, 'Generated', {
          page: page.url,
          length: generated.description.length,
          currentCTR: page.ctr,
          attempts: attempt,
          ...mergedMeta
        });
        return generated;
      }

      // Validation failed — record and retry
      failureHistory.push({ attempt, reason: failed });

      outcome(grp, 'Validation Failed', {
        page: page.url,
        reason: failed,
        attempt
      });

      lastGenerated = generated;
      lastReason = failed;
    }

    // All retries exhausted
    outcome(grp, 'Generation Failed', {
      page: page.url,
      attempts: maxRetries,
      lastReason,
      history: failureHistory
    });

    return { failed: true, url: page.url, attempts: maxRetries, lastReason, history: failureHistory };
  }

  buildUserPrompt(page) {
    let prompt = `Generate an optimized meta description for this page:

URL: ${page.url}
Current Title: ${page.currentTitle || 'Unknown'}
Current Description: ${page.currentDescription || 'None'}
Current CTR: ${(page.ctr * 100).toFixed(1)}%
Monthly Impressions: ${page.impressions.toLocaleString()}

${page.content ? `Page Content:\n${page.content}` : ''}`;

    // Include failure history so the LLM knows what NOT to do
    if (page.previousFailures?.length) {
      prompt += `\n\nPrevious generation attempts for this page FAILED. Avoid these mistakes:`;
      for (const f of page.previousFailures) {
        prompt += `\n- Attempt ${f.attempt}: ${f.reason}`;
      }
    }

    prompt += '\n\nGenerate a new title and description that will improve CTR.';
    return prompt;
  }
}
