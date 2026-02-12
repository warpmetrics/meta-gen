// Self-improvement engine — learns from feedback outcomes and generation failures
import OpenAI from 'openai';
import { warp, call, outcome } from '@warpmetrics/warp';

const API_BASE = 'https://api.warpmetrics.com/v1';

export class Improver {
  constructor(warpmetricsApiKey, openaiApiKey, promptManager) {
    this.warpmetricsApiKey = warpmetricsApiKey;
    this.openai = warp(new OpenAI({ apiKey: openaiApiKey }), { apiKey: warpmetricsApiKey });
    this.promptManager = promptManager;
  }

  async fetchOutcomes(name, from) {
    const results = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const params = new URLSearchParams({ name, from, limit: String(limit), offset: String(offset) });
      const res = await fetch(`${API_BASE}/outcomes?${params}`, {
        headers: { 'Authorization': `Bearer ${this.warpmetricsApiKey}` }
      });

      if (!res.ok) throw new Error(`Failed to fetch ${name} outcomes: ${res.statusText}`);

      const body = await res.json();
      results.push(...body.data);

      if (!body.pagination?.hasMore) break;
      offset += limit;
    }

    return results;
  }

  async analyze(grp, domain) {
    const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch the three outcome types we need in parallel
    const [highCTROutcomes, noImprovementOutcomes, genFailureOutcomes] = await Promise.all([
      this.fetchOutcomes('High CTR', fromDate),
      this.fetchOutcomes('No Improvement', fromDate),
      this.fetchOutcomes('Generation Failed', fromDate),
    ]);

    const highPerformers = highCTROutcomes
      .filter(o => o.opts?.description)
      .map(o => ({
        page: o.opts.page,
        title: o.opts.title,
        description: o.opts.description,
        ctr: o.opts.ctr,
        improvement: o.opts.improvement,
        baselineCTR: o.opts.baselineCTR
      }));

    const lowPerformers = noImprovementOutcomes
      .filter(o => o.opts?.description)
      .map(o => ({
        page: o.opts.page,
        title: o.opts.title,
        description: o.opts.description,
        ctr: o.opts.ctr,
        baselineCTR: o.opts.baselineCTR
      }));

    const generationFailures = genFailureOutcomes
      .filter(o => o.opts?.lastReason)
      .map(o => ({
        page: o.opts.page,
        attempts: o.opts.attempts,
        lastReason: o.opts.lastReason,
        history: o.opts.history
      }));

    if (highPerformers.length < 5) {
      outcome(grp, 'Insufficient Data', {
        highPerformers: highPerformers.length,
        needed: 5
      });
      return null;
    }

    // Build analysis prompt
    let analysisPrompt = `Analyze these meta descriptions and identify patterns that correlate with high CTR.

HIGH PERFORMERS (20%+ CTR increase):
${JSON.stringify(highPerformers.slice(0, 10), null, 2)}

LOW PERFORMERS (no improvement or decline):
${JSON.stringify(lowPerformers.slice(0, 10), null, 2)}`;

    if (generationFailures.length > 0) {
      analysisPrompt += `

GENERATION FAILURES (couldn't pass quality validation after multiple retries):
${JSON.stringify(generationFailures.slice(0, 10), null, 2)}

Also analyze why generation fails for these pages and suggest prompt improvements to handle them.`;
    }

    analysisPrompt += `

Identify:
1. Common patterns in high performers (word choice, structure, elements)
2. Common mistakes in low performers
3. Specific actionable improvements
${generationFailures.length > 0 ? '4. Why generation fails for certain page types and how to fix it' : ''}

Return JSON:
{
  "patterns": [
    {
      "description": "Brief pattern description",
      "example": "Example phrase",
      "impact": 2.1,
      "confidence": "high"
    }
  ],
  "improvements": "Specific changes to make to the generation prompt",
  "failureInsights": ["insight about why generation fails for certain pages"]
}`;

    const analysisRes = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: analysisPrompt }],
      response_format: { type: 'json_object' }
    });

    call(grp, analysisRes);

    const analysis = JSON.parse(analysisRes.choices[0].message.content);

    // Store learned patterns
    for (const pattern of analysis.patterns) {
      await this.promptManager.addPattern({
        ...pattern,
        sampleSize: highPerformers.length
      });
    }

    // Update quality prompt with improvements and failure insights
    const currentPrompt = await this.promptManager.getSystemPrompt();

    let updateInstructions = `IMPROVEMENTS TO MAKE:\n${analysis.improvements}`;
    if (analysis.failureInsights?.length) {
      updateInstructions += `\n\nFAILURE INSIGHTS (the generator struggles with these — address them):\n${analysis.failureInsights.join('\n')}`;
    }

    const improvedRes = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `Update this meta description generation prompt with these improvements:

CURRENT PROMPT:
${currentPrompt}

${updateInstructions}

Return the updated prompt. Keep the structure, just integrate the improvements.`
      }]
    });

    call(grp, improvedRes);

    await this.promptManager.updateQualityPrompt(improvedRes.choices[0].message.content);

    outcome(grp, 'Patterns Learned', {
      count: analysis.patterns.length,
      patterns: analysis.patterns.map(p => p.description),
      failureInsights: analysis.failureInsights || [],
      highPerformers: highPerformers.length,
      lowPerformers: lowPerformers.length,
      generationFailures: generationFailures.length
    });

    return { patternsLearned: analysis.patterns.length };
  }
}
