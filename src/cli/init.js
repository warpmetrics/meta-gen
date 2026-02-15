import { createInterface } from 'readline';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultsDir = join(__dirname, '..', '..', 'defaults');

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function log(msg) {
  console.log(msg);
}

export async function initCommand() {
  try {
    await run();
  } catch (err) {
    console.error('init failed:', err.message);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

async function run() {
  log('');
  log('  meta-gen \u2014 self-improving meta descriptions powered by WarpMetrics');
  log('');

  // 1. Domain
  const domainInput = await ask('  ? Domain (e.g. warpmetrics.dev): ');
  const domain = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!domain) {
    log('  \u2717 Domain is required');
    return;
  }

  // 2. GSC site URL
  const siteUrlDefault = `sc-domain:${domain}`;
  const siteUrlInput = await ask(`  ? GSC site URL (default: ${siteUrlDefault}): `);
  const siteUrl = siteUrlInput.trim() || siteUrlDefault;

  // 3. Exclude patterns
  const excludeInput = await ask('  ? Exclude patterns (comma-separated globs, or leave empty): ');
  const exclude = excludeInput.trim()
    ? excludeInput.split(',').map(p => p.trim()).filter(Boolean)
    : [];

  // 4. OpenAI API key
  const openaiKey = await ask('  ? OpenAI API key: ');
  if (openaiKey && !openaiKey.startsWith('sk-')) {
    log('  \u26a0 Warning: key doesn\'t start with sk- \u2014 make sure this is a valid OpenAI API key');
  }

  // 5. WarpMetrics API key
  const wmKey = await ask('  ? WarpMetrics API key (get one at warpmetrics.com/app/api-keys): ');
  if (wmKey && !wmKey.startsWith('wm_')) {
    log('  \u26a0 Warning: key doesn\'t start with wm_ \u2014 make sure this is a valid WarpMetrics API key');
  }

  // 6. GSC OAuth credentials
  const gscClientId = await ask('  ? GSC Client ID: ');
  const gscClientSecret = await ask('  ? GSC Client Secret: ');

  log('');

  // 7. Set GitHub secrets
  let ghAvailable = false;
  try {
    execSync('gh --version', { stdio: 'ignore' });
    ghAvailable = true;
  } catch {
    ghAvailable = false;
  }

  const secrets = [
    ['OPENAI_API_KEY', openaiKey],
    ['WARPMETRICS_API_KEY', wmKey],
    ['GSC_CLIENT_ID', gscClientId],
    ['GSC_CLIENT_SECRET', gscClientSecret],
  ];

  if (ghAvailable) {
    log('  Setting GitHub secrets...');
    for (const [name, value] of secrets) {
      if (!value) {
        log(`  \u26a0 Skipping ${name} (empty)`);
        continue;
      }
      try {
        execSync(`gh secret set ${name}`, { input: value, stdio: ['pipe', 'ignore', 'ignore'] });
        log(`  \u2713 ${name} set`);
      } catch (e) {
        log(`  \u2717 Failed to set ${name}: ${e.message}`);
      }
    }
  } else {
    log('  gh (GitHub CLI) not found. Set these secrets manually:');
    log('');
    for (const [name] of secrets) {
      log(`  gh secret set ${name}`);
    }
    log('  (gh will prompt for the value interactively)');
  }
  log('');

  // 8. Create meta-gen.config.json
  const configPath = 'meta-gen.config.json';
  let writeConfig = true;
  if (existsSync(configPath)) {
    const overwrite = await ask('  meta-gen.config.json already exists. Overwrite? (y/N): ');
    writeConfig = overwrite.toLowerCase() === 'y';
    if (!writeConfig) log('  Skipping config creation');
  }
  if (writeConfig) {
    const config = { domain, siteUrl };
    if (exclude.length > 0) config.exclude = exclude;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    log('  \u2713 meta-gen.config.json created');
  }

  // 9. Create workflow
  const workflowPath = '.github/workflows/meta-gen.yml';
  let writeWorkflow = true;
  if (existsSync(workflowPath)) {
    const overwrite = await ask('  Workflow already exists. Overwrite? (y/N): ');
    writeWorkflow = overwrite.toLowerCase() === 'y';
    if (!writeWorkflow) log('  Skipping workflow creation');
  }
  if (writeWorkflow) {
    mkdirSync('.github/workflows', { recursive: true });
    copyFileSync(join(defaultsDir, 'meta-gen.yml'), workflowPath);
    log('  \u2713 .github/workflows/meta-gen.yml created');
  }

  log('');

  // 10. Register outcome classifications
  if (wmKey) {
    log('  Registering outcome classifications with WarpMetrics...');
    const classifications = [
      { name: 'High CTR', classification: 'success' },
      { name: 'Improved', classification: 'success' },
      { name: 'Generated', classification: 'success' },
      { name: 'Patterns Learned', classification: 'success' },
      { name: 'Run Complete', classification: 'success' },
      { name: 'Length Passed', classification: 'neutral' },
      { name: 'Quality Passed', classification: 'neutral' },
      { name: 'Insufficient Data', classification: 'neutral' },
      { name: 'No Improvement', classification: 'failure' },
      { name: 'Run Failed', classification: 'failure' },
      { name: 'Generation Error', classification: 'failure' },
      { name: 'Generation Failed', classification: 'failure' },
      { name: 'Length Failed', classification: 'failure' },
      { name: 'Quality Failed', classification: 'failure' },
    ];

    let classOk = true;
    for (const { name, classification } of classifications) {
      try {
        const res = await fetch(`https://api.warpmetrics.com/v1/outcomes/classifications/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${wmKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ classification }),
        });
        if (!res.ok) {
          classOk = false;
          console.warn(`  \u26a0 Failed to set classification ${name}: ${res.status}`);
        }
      } catch (e) {
        classOk = false;
        console.warn(`  \u26a0 Failed to set classification ${name}: ${e.message}`);
      }
    }
    if (classOk) {
      log('  \u2713 Outcomes configured');
    } else {
      log('  \u26a0 Some classifications failed \u2014 you can set them manually in the WarpMetrics dashboard');
    }
  } else {
    log('  Skipping outcome classification setup (no WarpMetrics API key provided)');
  }

  // 11. Next steps
  log('');
  log('  Done! Next steps:');
  log('  1. Run meta-gen auth to authenticate with Google Search Console');
  log('  2. Set the GSC_CREDENTIALS secret: gh secret set GSC_CREDENTIALS < .gsc-credentials.json');
  log('  3. git add meta-gen.config.json .github/workflows/meta-gen.yml');
  log('  4. git commit -m "Add meta-gen"');
  log('  5. View analytics at https://app.warpmetrics.com');
  log('');
}
