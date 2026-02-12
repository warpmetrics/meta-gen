import { Improver } from '../core/improver.js';
import { PromptManager } from '../core/prompt-manager.js';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';

export async function improveCommand(options) {
  const spinner = ora('Running self-improvement analysis...').start();

  try {
    const config = JSON.parse(await fs.readFile('./meta-gen.config.json', 'utf-8'));

    const promptManager = new PromptManager('.');
    await promptManager.initialize();

    const improver = new Improver(
      process.env.WARPMETRICS_API_KEY,
      process.env.OPENAI_API_KEY,
      promptManager
    );

    spinner.text = 'Analyzing outcomes from WarpMetrics...';

    const result = await improver.analyze(config.domain);

    if (!result) {
      spinner.warn('Not enough data to improve yet');
      console.log(chalk.yellow(`\nNeed at least ${options.minSamples} high-CTR samples`));
      console.log(chalk.gray('Wait 7-14 days after generating descriptions for feedback'));
      return;
    }

    const { analysis } = result;

    spinner.succeed('Improvement analysis complete');

    console.log(chalk.bold('\nLearned Patterns\n'));

    analysis.patterns.forEach((p, i) => {
      console.log(`${i + 1}. ${chalk.cyan(p.description)}`);
      console.log(`   Impact: ${chalk.green(p.impact + 'x CTR')} | Example: "${p.example}"\n`);
    });

    console.log(chalk.green('Updated generation prompt with learnings'));
    console.log(chalk.gray('\nNext time you run meta-gen generate, it will use these patterns and link to this improvement'));

  } catch (err) {
    spinner.fail('Improvement failed');
    console.error(chalk.red(err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack));
    }
    process.exit(1);
  }
}
