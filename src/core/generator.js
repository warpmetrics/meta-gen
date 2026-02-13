// Generates meta descriptions with validation, retry, and WarpMetrics tracking
import { call, outcome, group } from '@warpmetrics/warp';
import { lengthValidator, qualityValidator } from './validators.js';
import { MODEL } from './config.js';

export async function generate(openai, promptManager, grp, pages, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const validators = options.validators || [
    lengthValidator(),
    qualityValidator(openai)
  ];

  const results = [];
  const failures = [];
  const systemPrompt = await promptManager.getSystemPrompt();
  const ctx = { target: grp, openai };

  for (const page of pages) {
    // Extract slug from URL for the group label
    const slug = new URL(page.url).pathname.replace(/^\/|\/$/g, '') || 'homepage';
    const pageGrp = group(grp, slug, {
      url: page.url,
      ctr: page.ctr,
      impressions: page.impressions,
    });
    const pageCtx = { target: pageGrp, openai };

    try {
      const result = await generateWithRetry(
        openai, pageGrp, systemPrompt, page, { maxRetries, validators, ctx: pageCtx }
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
      outcome(pageGrp, 'Generation Error', {
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

async function generateWithRetry(openai, grp, systemPrompt, page, { maxRetries, validators, ctx }) {
  let lastReason = null;
  const failureHistory = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserPrompt(page) }
    ];

    if (failureHistory.length > 0) {
      const rejections = failureHistory.map((f, i) =>
        `Attempt ${f.attempt}: "${f.generated.description}" — REJECTED: ${f.reason}`
      ).join('\n');
      messages.push({
        role: 'user',
        content: `Previous attempts were all rejected. Do NOT make minor tweaks — write something fundamentally different.\n\n${rejections}`
      });
    }

    const res = await openai.chat.completions.create({
      model: MODEL,
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

    failureHistory.push({ attempt, reason: failed, generated });

    outcome(grp, 'Validation Failed', {
      page: page.url,
      reason: failed,
      attempt
    });

    lastReason = failed;
  }

  outcome(grp, 'Generation Failed', {
    page: page.url,
    attempts: maxRetries,
    lastReason,
    history: failureHistory
  });

  return { failed: true, url: page.url, attempts: maxRetries, lastReason, history: failureHistory };
}

export function buildUserPrompt(page) {
  let prompt = `Generate an optimized meta description for this page:

URL: ${page.url}
Current Title: ${page.currentTitle || 'Unknown'}
Current Description: ${page.currentDescription || 'None'}
Current CTR: ${(page.ctr * 100).toFixed(1)}%
Monthly Impressions: ${page.impressions.toLocaleString()}

${page.content ? `Page Content:\n${page.content}` : ''}`;

  prompt += '\n\nGenerate a new title and description that will improve CTR.';
  return prompt;
}
