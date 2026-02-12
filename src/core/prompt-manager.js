// Manages prompt templates and learned improvements
import fs from 'fs/promises';
import path from 'path';

const BASE_PROMPT = `# Meta Description Generator

You generate SEO-optimized meta descriptions for web pages.

## CONSTRAINTS (NEVER VIOLATE)
- Length: 140-160 characters (hard limit)
- Format: Plain text, no markdown, no special chars except basic punctuation
- Tone: Match the brand voice from the page content
- Purpose: Maximize click-through rate from Google search results

## OUTPUT FORMAT
Return JSON only:
{
  "title": "Page title (50-60 chars)",
  "description": "Meta description (140-160 chars)"
}

## RULES
- Start with a benefit or action verb
- Include the main keyword naturally
- Create curiosity or urgency
- Be specific, not generic
- Avoid filler words ("actually", "basically", "simply")
- No clickbait or false promises
`;

const QUALITY_PROMPT_INITIAL = `## QUALITY GUIDELINES

### Initial Best Practices
- Mention time estimates if relevant ("5 minutes", "in seconds")
- Include numbers and specifics ("6 endpoints", "247 pages")
- Add social proof if available ("used by 1000+ teams")
- Mention free/trial if applicable
- Use active voice
- Create urgency without being salesy

### Status
No site-specific patterns learned yet. These will be added automatically as high-CTR descriptions are identified.
`;

export class PromptManager {
  constructor(configDir) {
    this.configDir = configDir;
    this.basePromptPath = path.join(configDir, 'prompts', 'base.md');
    this.qualityPromptPath = path.join(configDir, 'prompts', 'quality.md');
    this.patternsPath = path.join(configDir, 'prompts', 'patterns.json');
  }

  async initialize() {
    // Create prompts directory if it doesn't exist
    await fs.mkdir(path.join(this.configDir, 'prompts'), { recursive: true });

    // Create base prompt if it doesn't exist
    try {
      await fs.access(this.basePromptPath);
    } catch {
      await fs.writeFile(this.basePromptPath, BASE_PROMPT);
    }

    // Create quality prompt if it doesn't exist
    try {
      await fs.access(this.qualityPromptPath);
    } catch {
      await fs.writeFile(this.qualityPromptPath, QUALITY_PROMPT_INITIAL);
    }

    // Create patterns file if it doesn't exist
    try {
      await fs.access(this.patternsPath);
    } catch {
      await fs.writeFile(this.patternsPath, JSON.stringify({ patterns: [] }, null, 2));
    }
  }

  async getSystemPrompt() {
    const base = await fs.readFile(this.basePromptPath, 'utf-8');
    const quality = await fs.readFile(this.qualityPromptPath, 'utf-8');
    const patterns = JSON.parse(await fs.readFile(this.patternsPath, 'utf-8'));

    let prompt = `${base}\n\n${quality}`;

    if (patterns.patterns.length > 0) {
      prompt += '\n\n## LEARNED PATTERNS (from your high-CTR descriptions):\n';
      patterns.patterns.forEach(p => {
        prompt += `- ${p.description} (${p.impact}x CTR, ${p.sampleSize} samples)\n`;
      });
    }

    return prompt;
  }

  async updateQualityPrompt(newContent) {
    const timestamp = new Date().toISOString().split('T')[0];
    const backupPath = path.join(
      this.configDir,
      'prompts',
      `quality-${timestamp}.md`
    );

    // Backup old version
    const oldContent = await fs.readFile(this.qualityPromptPath, 'utf-8');
    await fs.writeFile(backupPath, oldContent);

    // Write new version
    await fs.writeFile(this.qualityPromptPath, newContent);
  }

  async addPattern(pattern) {
    const patterns = JSON.parse(await fs.readFile(this.patternsPath, 'utf-8'));
    patterns.patterns.push({
      ...pattern,
      addedAt: new Date().toISOString()
    });
    await fs.writeFile(this.patternsPath, JSON.stringify(patterns, null, 2));
  }

  async getPatterns() {
    const patterns = JSON.parse(await fs.readFile(this.patternsPath, 'utf-8'));
    return patterns.patterns;
  }
}
