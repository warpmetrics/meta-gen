#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { authCommand } from './auth.js';
import { analyzeCommand } from './analyze.js';
import { generateCommand } from './generate.js';
import { feedbackCommand } from './feedback.js';
import { improveCommand } from './improve.js';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('meta-gen')
  .description('Self-improving meta description generator with Google Search Console')
  .version('0.1.0');

program
  .command('auth')
  .description('Authenticate with Google Search Console')
  .action(authCommand);

program
  .command('analyze')
  .description('Analyze current meta description performance')
  .option('--min-impressions <number>', 'Minimum impressions to consider', '100')
  .option('--days <number>', 'Days of data to analyze', '30')
  .action(analyzeCommand);

program
  .command('generate')
  .description('Generate improved meta descriptions')
  .option('--threshold <number>', 'CTR threshold (pages below this get improved)', '3.0')
  .option('--max <number>', 'Maximum pages to generate', '50')
  .option('--output <path>', 'Output file path', './src/meta.json')
  .action(generateCommand);

program
  .command('feedback')
  .description('Collect performance feedback from GSC')
  .option('--min-days <number>', 'Minimum days since generation', '7')
  .option('--input <path>', 'Meta JSON file path', './src/meta.json')
  .action(feedbackCommand);

program
  .command('improve')
  .description('Run self-improvement analysis')
  .option('--min-samples <number>', 'Minimum high-CTR samples needed', '5')
  .action(improveCommand);

program.parse();
