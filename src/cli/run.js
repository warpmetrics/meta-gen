import { GSCClient } from '../core/gsc-client.js';
import { MetaGenerator } from '../core/generator.js';
import { PerformanceTracker } from '../core/tracker.js';
import { Improver } from '../core/improver.js';
import { PromptManager } from '../core/prompt-manager.js';
import { run, group, outcome, act, flush } from '@warpmetrics/warp';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});
turndown.remove(['script', 'style', 'svg', 'nav', 'header', 'footer', 'aside', 'noscript', 'iframe']);

function extractPageContent(html) {
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim() || null;
  const description = $('meta[name="description"]').attr('content')?.trim() || null;

  // Remove non-content elements before conversion
  $('script, style, svg, nav, header, footer, aside, noscript, iframe, [role="navigation"], [aria-hidden="true"]').remove();

  // Prefer main content area
  const mainEl = $('main, [role="main"], article').first();
  const contentHtml = mainEl.length ? mainEl.html() : $('body').html();

  const markdown = turndown.turndown(contentHtml || '');

  return { title, description, content: markdown };
}

export async function runCommand(options) {
  const spinner = ora('Starting Meta Gen...').start();

  try {
    const config = JSON.parse(await fs.readFile('./meta-gen.config.json', 'utf-8'));

    // Poll for Continue Optimization act from previous run
    let prevAct = null;
    try {
      const res = await fetch(
        'https://api.warpmetrics.com/v1/acts?name=Continue%20Optimization&hasFollowUp=false&limit=1',
        { headers: { 'Authorization': `Bearer ${process.env.WARPMETRICS_API_KEY}` } }
      );
      if (res.ok) {
        const body = await res.json();
        if (body.data?.length > 0) prevAct = body.data[0].id;
      }
    } catch {}

    // Create the run — linked to previous if exists
    const r = prevAct
      ? run(prevAct, 'Meta Gen', { domain: config.domain })
      : run('Meta Gen', { domain: config.domain });

    // Setup
    const gsc = new GSCClient('./.gsc-credentials.json');
    await gsc.authenticate();

    const promptManager = new PromptManager('.');
    await promptManager.initialize();

    // Load meta.json
    let metaJson = {};
    try {
      metaJson = JSON.parse(await fs.readFile(options.output, 'utf-8'));
    } catch {}

    // ═══════════════════════════════════════════
    // Phase 1: Feedback
    // ═══════════════════════════════════════════
    spinner.text = 'Collecting feedback...';
    const feedbackGrp = group(r, 'Feedback');
    const tracker = new PerformanceTracker(gsc);

    const feedbackResults = await tracker.trackPerformance(
      feedbackGrp,
      config.siteUrl,
      metaJson,
      parseInt(options.minDays)
    );

    if (feedbackResults.tracked > 0) {
      spinner.succeed(`Feedback: ${feedbackResults.tracked} tracked, ${feedbackResults.highPerformers} high performers`);
    } else {
      spinner.info('Feedback: no pages eligible yet');
    }

    // ═══════════════════════════════════════════
    // Phase 2: Learn
    // ═══════════════════════════════════════════
    spinner.start('Analyzing patterns...');
    const learnGrp = group(r, 'Learn');
    const improver = new Improver(
      process.env.WARPMETRICS_API_KEY,
      process.env.OPENAI_API_KEY,
      promptManager
    );

    const learnResults = await improver.analyze(learnGrp, config.domain);

    if (learnResults) {
      spinner.succeed(`Learn: ${learnResults.patternsLearned} patterns learned`);
    } else {
      spinner.info('Learn: not enough data yet');
    }

    // ═══════════════════════════════════════════
    // Phase 3: Generate
    // ═══════════════════════════════════════════
    spinner.start('Finding pages to improve...');
    const generateGrp = group(r, 'Generate');

    // Get candidates from GSC
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const rows = await gsc.getPagePerformance(config.siteUrl, startDate, endDate);

    const threshold = parseFloat(options.threshold) / 100;
    const minImpressions = parseInt(options.minImpressions);
    const excludePatterns = config.exclude || [];

    const candidates = rows
      .filter(row => {
        if (row.ctr >= threshold || row.impressions < minImpressions) return false;
        const pathname = new URL(row.keys[0]).pathname;
        return !excludePatterns.some(p =>
          new RegExp('^' + p.replace(/\*/g, '.*') + '$').test(pathname)
        );
      })
      .slice(0, parseInt(options.max))
      .map(row => ({ url: row.keys[0], ctr: row.ctr, impressions: row.impressions }));

    spinner.text = 'Fetching page content...';

    // Enrich candidates with page content (HTML → markdown)
    const enrichedCandidates = await Promise.all(
      candidates.map(async (page) => {
        try {
          const res = await fetch(page.url);
          const html = await res.text();
          const { title, description, content } = extractPageContent(html);

          const enriched = {
            ...page,
            currentTitle: title,
            currentDescription: description,
            content: content.substring(0, 3000)
          };

          // Attach failure history from meta.json if this page previously failed
          const pathname = new URL(page.url).pathname;
          const existing = metaJson[pathname];
          if (existing?.failed) {
            enriched.previousFailures = existing.failures;
          }

          return enriched;
        } catch (err) {
          return page;
        }
      })
    );

    spinner.text = 'Generating descriptions...';

    const generator = new MetaGenerator(
      process.env.OPENAI_API_KEY,
      process.env.WARPMETRICS_API_KEY,
      promptManager
    );

    const genResults = await generator.generate(generateGrp, enrichedCandidates, {
      domain: config.domain,
      maxRetries: parseInt(options.maxRetries) || 3
    });

    spinner.succeed(
      `Generate: ${genResults.results.length} created` +
      (genResults.failures.length > 0 ? `, ${genResults.failures.length} failed` : '')
    );

    // ═══════════════════════════════════════════
    // Update meta.json
    // ═══════════════════════════════════════════

    // Save successful generations (keyed by pathname so the frontend can look them up)
    for (const result of genResults.results) {
      const pathname = new URL(result.url).pathname;
      metaJson[pathname] = {
        title: result.title,
        description: result.description,
        generatedAt: result.generatedAt,
        runId: r.id,
        baseline: {
          ctr: result.currentCTR,
          impressions: result.impressions
        }
      };
    }

    // Save failures so the next run can include failure history in the prompt
    for (const failure of genResults.failures) {
      const pathname = new URL(failure.url).pathname;
      metaJson[pathname] = {
        failed: true,
        failedAt: new Date().toISOString(),
        runId: r.id,
        attempts: failure.attempts,
        lastReason: failure.lastReason,
        failures: failure.history
      };
    }

    await fs.writeFile(options.output, JSON.stringify(metaJson, null, 2));

    // ═══════════════════════════════════════════
    // Run complete — link to next run
    // ═══════════════════════════════════════════
    const runComplete = outcome(r, 'Run Complete', {
      generated: genResults.results.length,
      generationFailed: genResults.failures.length,
      tracked: feedbackResults.tracked,
      highPerformers: feedbackResults.highPerformers,
      patternsLearned: learnResults?.patternsLearned || 0
    });

    act(runComplete, 'Continue Optimization');

    await flush();

    // Summary
    console.log(chalk.bold('\nMeta Gen Complete\n'));
    console.log(`  Feedback:  ${feedbackResults.tracked} tracked, ${feedbackResults.highPerformers} high CTR`);
    console.log(`  Learn:     ${learnResults ? `${learnResults.patternsLearned} patterns` : 'insufficient data'}`);
    console.log(`  Generate:  ${genResults.results.length} created, ${genResults.failures.length} failed`);
    console.log(chalk.gray(`\n  Run: https://app.warpmetrics.com/runs/${r.id}`));
    console.log(chalk.gray(`  Saved to ${options.output}`));

  } catch (err) {
    spinner.fail('Meta Gen failed');
    console.error(chalk.red(err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack));
    }
    process.exit(1);
  }
}
