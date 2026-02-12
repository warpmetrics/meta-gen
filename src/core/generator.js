// Generates meta descriptions with WarpMetrics tracking
import OpenAI from 'openai';
import { warp, run, call, outcome, flush } from '@warpmetrics/warp';

export class MetaGenerator {
  constructor(apiKey, warpmetricsApiKey, promptManager) {
    this.openai = warp(new OpenAI({ apiKey }), { apiKey: warpmetricsApiKey });
    this.promptManager = promptManager;
  }

  async generate(pages, options = {}) {
    const runOpts = {
      domain: options.domain,
      pageCount: pages.length,
      batchId: Date.now().toString(),
      usingImprovedPrompts: !!options.actRef
    };

    // If we have an act reference, link this run to the improvement act
    const r = options.actRef
      ? run(options.actRef, 'Meta Description Generation', runOpts)
      : run('Meta Description Generation', runOpts);

    const results = [];
    const systemPrompt = await this.promptManager.getSystemPrompt();

    for (const page of pages) {
      try {
        const res = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: this.buildUserPrompt(page)
            }
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        });

        call(r, res, { page: page.url });

        const generated = JSON.parse(res.choices[0].message.content);

        // Validate length
        if (generated.description.length < 140 || generated.description.length > 160) {
          outcome(r, 'Invalid Length', {
            page: page.url,
            length: generated.description.length
          });
          continue;
        }

        results.push({
          url: page.url,
          title: generated.title,
          description: generated.description,
          currentCTR: page.ctr,
          impressions: page.impressions,
          runId: r.id,
          generatedAt: new Date().toISOString()
        });

        outcome(r, 'Generated', {
          page: page.url,
          length: generated.description.length,
          currentCTR: page.ctr
        });

      } catch (err) {
        outcome(r, 'Generation Error', {
          page: page.url,
          error: err.message
        });
      }
    }

    await flush();

    return {
      runId: r.id,
      results
    };
  }

  buildUserPrompt(page) {
    return `Generate an optimized meta description for this page:

URL: ${page.url}
Current Title: ${page.currentTitle || 'Unknown'}
Current Description: ${page.currentDescription || 'None'}
Current CTR: ${(page.ctr * 100).toFixed(1)}%
Monthly Impressions: ${page.impressions.toLocaleString()}

${page.content ? `Page Content Preview:\n${page.content.substring(0, 500)}...` : ''}

Generate a new title and description that will improve CTR.`;
  }
}
