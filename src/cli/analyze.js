import { GSCClient } from '../core/gsc-client.js';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';

export async function analyzeCommand(options) {
  const spinner = ora('Loading configuration...').start();

  try {
    // Load config
    const config = JSON.parse(await fs.readFile('./meta-gen.config.json', 'utf-8'));

    const gsc = new GSCClient('./.gsc-credentials.json');
    await gsc.authenticate();

    spinner.text = 'Fetching performance data from Google Search Console...';

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - parseInt(options.days) * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const rows = await gsc.getPagePerformance(
      config.siteUrl,
      startDate,
      endDate
    );

    spinner.succeed(`Analyzed ${rows.length} pages`);

    // Filter and sort
    const minImpressions = parseInt(options.minImpressions);
    const filtered = rows
      .filter(row => row.impressions >= minImpressions)
      .sort((a, b) => a.ctr - b.ctr);

    // Display results
    console.log(chalk.bold('\nPerformance Summary\n'));

    const avgCTR = (filtered.reduce((sum, r) => sum + r.ctr, 0) / filtered.length * 100).toFixed(2);
    console.log(`Average CTR: ${chalk.cyan(avgCTR + '%')}`);
    console.log(`Pages analyzed: ${chalk.cyan(filtered.length)}`);

    const lowCTR = filtered.filter(r => r.ctr < 0.03);
    console.log(`Pages below 3% CTR: ${chalk.yellow(lowCTR.length)}`);

    console.log(chalk.bold('\nTop Improvement Opportunities\n'));

    lowCTR.slice(0, 10).forEach((row, i) => {
      console.log(`${i + 1}. ${chalk.gray(row.keys[0])}`);
      console.log(`   CTR: ${chalk.red((row.ctr * 100).toFixed(2) + '%')} | Impressions: ${chalk.gray(row.impressions.toLocaleString())}\n`);
    });

    console.log(chalk.gray(`Run ${chalk.white('meta-gen generate')} to create improved descriptions`));

  } catch (err) {
    spinner.fail('Analysis failed');
    console.error(chalk.red(err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack));
    }
    process.exit(1);
  }
}
