import { GSCClient } from '../core/gsc-client.js';
import { PerformanceTracker } from '../core/tracker.js';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';

export async function feedbackCommand(options) {
  const spinner = ora('Loading configuration...').start();

  try {
    const config = JSON.parse(await fs.readFile('./meta-gen.config.json', 'utf-8'));

    // Read meta.json to find pages that need tracking
    let metaJson = {};
    try {
      metaJson = JSON.parse(await fs.readFile(options.input, 'utf-8'));
    } catch (err) {
      spinner.fail('No meta.json found');
      console.log(chalk.gray('\nRun meta-gen generate first to create descriptions'));
      return;
    }

    // Find pages generated 7+ days ago that haven't been tracked recently
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const eligiblePages = Object.entries(metaJson)
      .filter(([url, meta]) => {
        const daysAgo = (now - new Date(meta.generatedAt).getTime()) / (1000 * 60 * 60 * 24);
        return daysAgo >= options.minDays && meta.runId;
      });

    if (eligiblePages.length === 0) {
      spinner.info('No pages eligible for tracking yet');
      console.log(chalk.gray(`\nPages must be at least ${options.minDays} days old`));
      console.log(chalk.gray('Current pages:'));
      Object.entries(metaJson).forEach(([url, meta]) => {
        const daysAgo = ((now - new Date(meta.generatedAt).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1);
        console.log(chalk.gray(`  ${url}: ${daysAgo} days ago`));
      });
      return;
    }

    spinner.succeed(`Found ${eligiblePages.length} pages to track`);

    const gsc = new GSCClient('./.gsc-credentials.json');
    await gsc.authenticate();

    const tracker = new PerformanceTracker(
      gsc,
      process.env.WARPMETRICS_API_KEY
    );

    // Group pages by runId to track each generation batch
    const pagesByRun = {};
    for (const [url, meta] of eligiblePages) {
      if (!pagesByRun[meta.runId]) {
        pagesByRun[meta.runId] = [];
      }
      pagesByRun[meta.runId].push({ url, ...meta });
    }

    spinner.start('Tracking performance...');

    let totalTracked = 0;
    let totalHighPerformers = 0;

    for (const [runId, pages] of Object.entries(pagesByRun)) {
      const result = await tracker.trackPerformance(
        config.siteUrl,
        runId,
        pages,
        options.minDays
      );

      totalTracked += result.tracked;
      totalHighPerformers += result.highPerformers;

      console.log(chalk.gray(`  Run ${runId.substring(0, 8)}: ${result.tracked} tracked, ${result.highPerformers} high performers`));
    }

    spinner.succeed('Performance tracking complete');

    console.log(chalk.bold('\nResults\n'));
    console.log(`Pages tracked: ${totalTracked}`);
    console.log(`High performers: ${chalk.green(totalHighPerformers)} (${((totalHighPerformers / totalTracked) * 100).toFixed(0)}%)`);

    if (totalHighPerformers >= 5) {
      console.log(chalk.green('\nEnough data collected! Run meta-gen improve to learn from this data'));
    } else {
      console.log(chalk.yellow(`\nNeed ${5 - totalHighPerformers} more high performers before running improve`));
    }

  } catch (err) {
    spinner.fail('Feedback collection failed');
    console.error(chalk.red(err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack));
    }
    process.exit(1);
  }
}
