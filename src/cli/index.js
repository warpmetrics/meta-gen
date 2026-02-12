#!/usr/bin/env node
import { Command } from 'commander';
import { authCommand } from './auth.js';
import { analyzeCommand } from './analyze.js';
import { runCommand } from './run.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('meta-gen')
  .description('Self-improving meta description generator with Google Search Console')
  .version(version);

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
  .command('run')
  .description('Run the full meta-gen flywheel: feedback → learn → generate')
  .option('--threshold <number>', 'CTR threshold (pages below this get improved)', '3.0')
  .option('--max <number>', 'Maximum pages to generate', '50')
  .option('--min-impressions <number>', 'Minimum impressions required', '100')
  .option('--min-days <number>', 'Minimum days before collecting feedback', '7')
  .option('--max-retries <number>', 'Max retries per page on validation failure', '3')
  .option('--output <path>', 'Output file path', './src/meta.json')
  .action(runCommand);

program.parse();
