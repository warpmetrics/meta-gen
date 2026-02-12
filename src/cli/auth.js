import { createGSCClient } from '../core/gsc-client.js';
import chalk from 'chalk';
import ora from 'ora';

export async function authCommand() {
  const spinner = ora('Authenticating with Google Search Console...').start();

  try {
    const client = createGSCClient('./.gsc-credentials.json');

    // Check if already authenticated
    try {
      const isAuth = await client.authenticate();
      if (isAuth) {
        spinner.succeed('Already authenticated!');
        process.exit(0);
      }
    } catch {
      // Not authenticated or token expired — proceed to OAuth
    }

    spinner.text = 'Opening browser for OAuth...';
    await client.initiateOAuth();

    spinner.succeed('Authentication successful!');
    console.log(chalk.gray('Credentials saved to .gsc-credentials.json'));
    console.log(chalk.yellow('\nWARNING: Add .gsc-credentials.json to .gitignore'));
    process.exit(0);
  } catch (err) {
    spinner.fail('Authentication failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}
