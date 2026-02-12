import { GSCClient } from '../core/gsc-client.js';
import { MetaGenerator } from '../core/generator.js';
import { PromptManager } from '../core/prompt-manager.js';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';

export async function generateCommand(options) {
  const spinner = ora('Loading configuration...').start();

  try {
    const config = JSON.parse(await fs.readFile('./meta-gen.config.json', 'utf-8'));

    // Check for recent improvement act without a follow-up run
    let actRef = null;
    try {
      spinner.text = 'Checking for recent improvements...';

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const response = await fetch(
        `https://api.warpmetrics.com/v1/acts?name=Apply%20Improvements&hasFollowUp=false&from=${thirtyDaysAgo}&limit=1`,
        {
          headers: { 'Authorization': `Bearer ${process.env.WARPMETRICS_API_KEY}` }
        }
      );

      if (response.ok) {
        const acts = await response.json();
        if (acts.length > 0) {
          actRef = acts[0].id;
          spinner.info(`Linked to improvement analysis from ${new Date(acts[0].timestamp).toLocaleDateString()}`);
        }
      }
    } catch (err) {
      // Failed to fetch acts - continue without linking
      spinner.warn('Could not fetch improvement history');
    }

    spinner.text = 'Loading configuration...';

    const gsc = new GSCClient('./.gsc-credentials.json');
    await gsc.authenticate();

    const promptManager = new PromptManager('.');
    await promptManager.initialize();

    const generator = new MetaGenerator(
      process.env.OPENAI_API_KEY,
      process.env.WARPMETRICS_API_KEY,
      promptManager
    );

    spinner.text = 'Fetching pages to improve...';

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const rows = await gsc.getPagePerformance(config.siteUrl, startDate, endDate);

    const threshold = parseFloat(options.threshold) / 100;
    const candidates = rows
      .filter(r => r.ctr < threshold && r.impressions >= 100)
      .slice(0, parseInt(options.max))
      .map(r => ({
        url: r.keys[0],
        ctr: r.ctr,
        impressions: r.impressions
      }));

    spinner.succeed(`Found ${candidates.length} pages to improve`);

    if (candidates.length === 0) {
      console.log(chalk.green('\nAll pages are performing well!'));
      return;
    }

    spinner.start(`Generating meta descriptions...`);

    const { runId, results } = await generator.generate(candidates, {
      domain: config.domain,
      actRef
    });

    spinner.succeed(`Generated ${results.length} descriptions`);

    // Load existing meta.json or create new
    let metaJson = {};
    try {
      metaJson = JSON.parse(await fs.readFile(options.output, 'utf-8'));
    } catch {}

    // Update with new descriptions
    results.forEach(r => {
      metaJson[r.url] = {
        title: r.title,
        description: r.description,
        generatedAt: r.generatedAt,
        runId,
        baseline: {
          ctr: r.currentCTR,
          impressions: r.impressions
        }
      };
    });

    await fs.writeFile(options.output, JSON.stringify(metaJson, null, 2));

    console.log(chalk.green(`\nSaved to ${options.output}`));
    console.log(chalk.gray(`\nTracked in WarpMetrics: ${chalk.white(`https://app.warpmetrics.com/runs/${runId}`)}`));
    console.log(chalk.gray(`\nCommit changes:`));
    console.log(chalk.white(`  git add ${options.output}`));
    console.log(chalk.white(`  git commit -m "chore: improve meta descriptions (AI-generated)"`));

  } catch (err) {
    spinner.fail('Generation failed');
    console.error(chalk.red(err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack));
    }
    process.exit(1);
  }
}
