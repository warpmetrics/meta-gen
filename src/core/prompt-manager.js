// Manages prompt templates and learned improvements
import fs from 'fs/promises';
import path from 'path';

const BASE_PROMPT = `# Meta Description Generator

You write titles and descriptions that win clicks on Google search results pages.

## HARD CONSTRAINTS
- Title: 50-60 characters
- Description: 140-160 characters
- Plain text only. No markdown, no em dashes, no en dashes. Use commas, periods, or hyphens.

## HOW GOOGLE SERPS WORK

A searcher sees 10 blue links. Each has a title, URL, and description. They scan in 2-3 seconds and click ONE. Your description competes against 9 others. Mobile truncates around 120 chars, so front-load the hook.

## WHAT MAKES PEOPLE CLICK

1. **Specificity beats generality.** "Compare 3 plans starting at $0/mo" beats "Check out our pricing." Numbers, proper nouns, and concrete details signal substance.
2. **Answer the implicit question.** Every search has intent. "what is X" wants a definition. "X vs Y" wants a comparison. "X pricing" wants numbers. Match the intent the URL would rank for.
3. **Create an information gap.** Give enough to prove you have the answer, withhold enough to require the click. "6 causes of X (and the one most teams miss)" — not "Learn about X."
4. **Differentiate from competitors.** Generic descriptions blend in. What is TRUE about this page that is NOT true about the other 9 results? That's your angle.

## WHAT KILLS CTR

These patterns make descriptions invisible in SERPs — searchers skip right past them:

- "Discover how to..." / "Learn about..." / "Explore our..." — every AI writes this. Searchers are blind to it.
- "Comprehensive guide" / "ultimate" / "everything you need to know" — empty superlatives. Says nothing specific.
- "Transform your X" / "Unlock the power of" / "Take your X to the next level" — marketing cliches that signal fluff.
- "Start today!" / "Get started now!" / "Don't miss out!" — generic CTAs that add nothing. Use the characters for information instead.
- Repeating the page title in the description — wastes characters, the searcher already sees the title.
- Stacking adjectives without evidence — "powerful, intuitive, seamless" means nothing without proof.

## HOW TO WRITE THE DESCRIPTION

1. Read the page content. Find the ONE most specific, compelling fact.
2. Lead with that fact or the primary benefit in concrete terms.
3. Add a second element: a number, a differentiator, a qualifier, or a mechanism.
4. If space remains, close with what the reader gets or can do — but only if it adds information.

## HOW TO WRITE THE TITLE

1. The title should be a better version of the page's existing title — clearer, more specific, better keyword placement.
2. Put the primary keyword near the front.
3. Use a separator (- or |) between the topic and brand name if needed.
4. Never stuff keywords. Read it aloud — it should sound like something a human would write as a heading.

## EXAMPLES OF GOOD VS BAD

Bad: "Discover our pricing plans and find the perfect option for your team. Start your free trial today!"
Good: "Free tier included. Pro starts at $49/mo for teams. Compare plans side-by-side with no commitment."

Bad: "Learn how our powerful analytics platform can transform your business with comprehensive insights."
Good: "Track 12 metrics per AI agent run. See cost, latency, and success rates in one dashboard. Free for 7 days."

Bad: "The ultimate guide to API monitoring. Everything you need to know about keeping your APIs running smoothly."
Good: "3 monitoring patterns that catch 90% of API failures before users notice. With code examples for Node.js and Python."
`;


const QUALITY_PROMPT_INITIAL = `## QUALITY GUIDELINES

### Extracting specifics from page content
- Pull exact numbers from the page: pricing, counts, percentages, time savings.
- Identify the page type (landing, docs, pricing, blog, changelog) and match the intent.
- Find what makes this page different from a generic page on the same topic.

### Writing techniques
- Front-load: the first 100 chars must work standalone (mobile truncation).
- One idea per clause. Short sentences. No compound sentences joined by "and" unless both halves carry weight.
- Active voice, present tense. "Tracks 12 metrics" not "Can be used to track metrics."
- If the page has a free tier, pricing, or trial — mention it. This is high-signal for click decisions.

### Status
No site-specific patterns learned yet. These guidelines will be refined automatically as high-CTR patterns emerge from real data.
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
