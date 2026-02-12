// Self-improvement engine
import OpenAI from 'openai';
import { warp, run, call, outcome, act, ref, flush } from '@warpmetrics/warp';

export class Improver {
  constructor(warpmetricsApiKey, openaiApiKey, promptManager) {
    this.warpmetricsApiKey = warpmetricsApiKey;
    this.openai = warp(new OpenAI({ apiKey: openaiApiKey }), { apiKey: warpmetricsApiKey });
    this.promptManager = promptManager;
  }

  async analyze(domain) {
    const r = run('Self Improvement Analysis', { domain });

    // Fetch performance tracking outcomes (these are created by PerformanceTracker)
    const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const response = await fetch(
      `https://api.warpmetrics.com/v1/outcomes?from=${fromDate}`,
      {
        headers: { 'Authorization': `Bearer ${this.warpmetricsApiKey}` }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch outcomes: ${response.statusText}`);
    }

    const outcomes = await response.json();

    // Filter for performance tracking outcomes (from feedback collection)
    const performanceOutcomes = outcomes.filter(o =>
      o.targetLabel === 'Performance Tracking' && o.opts?.generationRunId
    );

    // Identify high performers (CTR increased by 20%+)
    const highPerformers = performanceOutcomes
      .filter(o => o.name === 'High CTR' && o.opts?.description)
      .map(o => ({
        page: o.opts.page,
        title: o.opts.title,
        description: o.opts.description,
        ctr: o.opts.ctr,
        improvement: o.opts.improvement,
        baselineCTR: o.opts.baselineCTR,
        impressions: o.opts.impressions
      }));

    // Identify low performers
    const lowPerformers = performanceOutcomes
      .filter(o => o.name === 'No Improvement' && o.opts?.description)
      .map(o => ({
        page: o.opts.page,
        title: o.opts.title,
        description: o.opts.description,
        ctr: o.opts.ctr,
        baselineCTR: o.opts.baselineCTR
      }));

    if (highPerformers.length < 5) {
      outcome(r, 'Insufficient Data', {
        highPerformers: highPerformers.length,
        needed: 5
      });
      await flush();
      return null;
    }

    // Use LLM to identify patterns
    const analysisRes = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `Analyze these meta descriptions and identify patterns that correlate with high CTR.

HIGH PERFORMERS (20%+ CTR increase):
${JSON.stringify(highPerformers.slice(0, 10), null, 2)}

LOW PERFORMERS (no improvement or decline):
${JSON.stringify(lowPerformers.slice(0, 10), null, 2)}

Identify:
1. Common patterns in high performers (word choice, structure, elements)
2. Common mistakes in low performers
3. Specific actionable improvements

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
  "improvements": "Specific changes to make to the generation prompt"
}`
      }],
      response_format: { type: 'json_object' }
    });

    call(r, analysisRes);

    const analysis = JSON.parse(analysisRes.choices[0].message.content);

    // Store learned patterns
    for (const pattern of analysis.patterns) {
      await this.promptManager.addPattern({
        ...pattern,
        sampleSize: highPerformers.length
      });
    }

    // Update quality prompt
    const currentQuality = await this.promptManager.getSystemPrompt();
    const improvedQuality = await this.generateImprovedPrompt(
      currentQuality,
      analysis.improvements
    );

    await this.promptManager.updateQualityPrompt(improvedQuality);

    const oc = outcome(r, 'Improvement Applied', {
      patternsLearned: analysis.patterns.length,
      highPerformers: highPerformers.length,
      lowPerformers: lowPerformers.length
    });

    // Create act: we're going to apply these learnings in the next generation
    const applyAct = act(oc, 'Apply Improvements', {
      patterns: analysis.patterns.map(p => p.description),
      sampleSize: highPerformers.length
    });

    await flush();

    return {
      analysis,
      actRef: ref(applyAct)
    };
  }

  async generateImprovedPrompt(currentPrompt, improvements) {
    const res = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `Update this meta description generation prompt with these improvements:

CURRENT PROMPT:
${currentPrompt}

IMPROVEMENTS TO MAKE:
${improvements}

Return the updated prompt. Keep the structure, just integrate the improvements.`
      }]
    });

    return res.choices[0].message.content;
  }
}
