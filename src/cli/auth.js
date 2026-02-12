import { GSCClient } from '../core/gsc-client.js';
import chalk from 'chalk';
import ora from 'ora';

export async function authCommand() {
  const spinner = ora('Authenticating with Google Search Console...').start();

  try {
    const client = new GSCClient('./.gsc-credentials.json');

    // Check if already authenticated
    const isAuth = await client.authenticate();

    if (isAuth) {
      spinner.succeed('Already authenticated!');
      return;
    }

    spinner.text = 'Opening browser for OAuth...';
    await client.initiateOAuth();

    spinner.succeed('Authentication successful!');
    console.log(chalk.gray('Credentials saved to .gsc-credentials.json'));
    console.log(chalk.yellow('\nWARNING: Add .gsc-credentials.json to .gitignore'));
  } catch (err) {
    spinner.fail('Authentication failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}
