import { outcome, call } from '@warpmetrics/warp';
import { MODEL } from './config.js';

export function lengthValidator({ min = 140, max = 160 } = {}) {
  return async (generated, page, ctx) => {
    const len = generated.description.length;

    if (len < min || len > max) {
      outcome(ctx.target, 'Length Failed', { page: page.url, length: len, min, max });
      return { pass: false, reason: `Description is ${len} chars, must be ${min}-${max}` };
    }

    outcome(ctx.target, 'Length Passed', { page: page.url, length: len });
    return { pass: true };
  };
}

export function qualityValidator(openai, { threshold = 7 } = {}) {
  return async (generated, page, ctx) => {
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `Score this meta description 1-10 for click-through rate potential on a Google SERP.

Scoring rubric:
- 9-10: Contains a specific number or concrete claim from the page, differentiates from generic competitors, front-loads the hook, no wasted words.
- 7-8: Specific and relevant, but could be tighter. Minor issues like a weak closing or slightly generic phrasing.
- 5-6: Technically accurate but reads like any competitor could say it. Lacks a specific differentiator.
- 3-4: Generic marketing copy. Uses filler phrases ("discover", "comprehensive", "unlock", "transform"). Could describe any product.
- 1-2: Wrong intent, factually inaccurate, or pure fluff with no information content.

Auto-deduct 2 points for any of: "discover", "unlock", "comprehensive", "ultimate", "transform", "elevate", "streamline", "take your X to the next level", "start today!", or repeating the title in the description.`
        },
        {
          role: 'user',
          content: `Page: ${page.url}
${page.currentTitle ? `Current Title: ${page.currentTitle}` : ''}
${page.content ? `Page Content:\n${page.content.substring(0, 500)}` : ''}

Generated Title: ${generated.title}
Generated Description: ${generated.description}`
        }
      ],
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'quality_score',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              score: { type: 'number' },
              feedback: { type: 'string' },
            },
            required: ['score', 'feedback'],
            additionalProperties: false,
          },
        },
      },
    });

    call(ctx.target, res, { page: page.url, validator: 'quality' });

    const { score, feedback } = JSON.parse(res.choices[0].message.content);

    if (score < threshold) {
      outcome(ctx.target, 'Quality Failed', { page: page.url, score, threshold, feedback });
      return { pass: false, reason: `Quality score ${score}/10 (needs ${threshold}+): ${feedback}` };
    }

    outcome(ctx.target, 'Quality Passed', { page: page.url, score, feedback });
    return { pass: true, meta: { qualityScore: score, qualityFeedback: feedback } };
  };
}
