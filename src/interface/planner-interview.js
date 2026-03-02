/**
 * Planner Interview — Interactive Clarifying Questions
 *
 * Before generating a task graph, the planner asks the user
 * clarifying questions across multiple categories to produce
 * a more targeted plan.
 *
 * Inspired by Claude Code's interview flow:
 *   ← ■ Purpose  □ Tech  □ Pages  □ Submit →
 *
 *   What is the purpose of the watch website?
 *
 *   1. Watch store/shop
 *   2. Watch showcase
 *   3. Digital clock
 *   4. Type something.
 *
 *   5. Chat about this
 *   6. Skip interview and plan immediately
 */

// ─── ANSI ────────────────────────────────────────────────────────
const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    brightGreen: '\x1b[92m',
    brightCyan: '\x1b[96m',
    inverse: '\x1b[7m',
};

function c(color, text) {
    return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

// ─── Interview Templates ─────────────────────────────────────────
// Each template defines the question categories for a detected project type.
// The system auto-detects the type from the user's prompt.

const INTERVIEW_TEMPLATES = {
    website: {
        categories: ['Purpose', 'Tech', 'Pages', 'Style'],
        steps: [
            {
                category: 'Purpose',
                question: 'What is the purpose of this website?',
                options: [
                    { label: 'E-commerce / Online store', desc: 'Sell products with cart and checkout' },
                    { label: 'Portfolio / Showcase', desc: 'Display work, projects, or collections' },
                    { label: 'Landing page', desc: 'Single page with call-to-action' },
                    { label: 'Blog / Content site', desc: 'Articles, posts, and content-driven pages' },
                    { label: 'Dashboard / Web app', desc: 'Interactive application with data' },
                ],
            },
            {
                category: 'Tech',
                question: 'What tech stack do you want?',
                options: [
                    { label: 'HTML + CSS + JS', desc: 'Simple, no build tools, just files' },
                    { label: 'React (Vite)', desc: 'Modern React with Vite bundler' },
                    { label: 'Next.js', desc: 'Full-stack React with SSR' },
                    { label: 'Vue.js', desc: 'Progressive framework with Vite' },
                    { label: 'Let APES decide', desc: 'Auto-select based on project needs' },
                ],
            },
            {
                category: 'Pages',
                question: 'What pages do you need?',
                options: [
                    { label: 'Home + About + Contact', desc: 'Standard 3-page site' },
                    { label: 'Home + Products + Cart + Checkout', desc: 'E-commerce flow' },
                    { label: 'Home + Gallery + Details', desc: 'Showcase with item details' },
                    { label: 'Single page (sections)', desc: 'One page with scrollable sections' },
                    { label: 'Custom (describe below)', desc: 'Type your own page list' },
                ],
            },
            {
                category: 'Style',
                question: 'What visual style do you prefer?',
                options: [
                    { label: 'Modern & minimal', desc: 'Clean, lots of whitespace, subtle animations' },
                    { label: 'Bold & colorful', desc: 'Vibrant colors, gradients, dynamic feel' },
                    { label: 'Dark & sleek', desc: 'Dark mode, glassmorphism, neon accents' },
                    { label: 'Classic & elegant', desc: 'Serif fonts, muted tones, sophisticated' },
                    { label: 'Let APES decide', desc: 'Auto-select best style for the project' },
                ],
            },
        ],
    },

    app: {
        categories: ['Type', 'Features', 'Data', 'Deploy'],
        steps: [
            {
                category: 'Type',
                question: 'What type of application is this?',
                options: [
                    { label: 'Web application', desc: 'Browser-based interactive app' },
                    { label: 'CLI tool', desc: 'Command-line utility' },
                    { label: 'API / Backend service', desc: 'REST or GraphQL API server' },
                    { label: 'Desktop app', desc: 'Electron or native desktop' },
                    { label: 'Mobile app', desc: 'React Native or similar' },
                ],
            },
            {
                category: 'Features',
                question: 'What core features do you need?',
                options: [
                    { label: 'User auth (login/signup)', desc: 'Authentication and user accounts' },
                    { label: 'CRUD operations', desc: 'Create, read, update, delete data' },
                    { label: 'Real-time updates', desc: 'WebSockets, live data, notifications' },
                    { label: 'File upload/management', desc: 'Upload, store, and manage files' },
                    { label: 'Basic (no special features)', desc: 'Keep it simple' },
                ],
            },
            {
                category: 'Data',
                question: 'How should data be stored?',
                options: [
                    { label: 'Local storage / JSON files', desc: 'Simple, no database needed' },
                    { label: 'SQLite', desc: 'Lightweight embedded database' },
                    { label: 'PostgreSQL / MySQL', desc: 'Full relational database' },
                    { label: 'MongoDB', desc: 'NoSQL document database' },
                    { label: 'Let APES decide', desc: 'Auto-select based on project needs' },
                ],
            },
            {
                category: 'Deploy',
                question: 'Where will this be deployed?',
                options: [
                    { label: 'Local only', desc: 'Just run on this machine' },
                    { label: 'Vercel / Netlify', desc: 'Serverless deployment' },
                    { label: 'Docker', desc: 'Containerized deployment' },
                    { label: 'VPS / Cloud server', desc: 'AWS, GCP, or DigitalOcean' },
                    { label: 'Not sure yet', desc: 'Decide later' },
                ],
            },
        ],
    },

    general: {
        categories: ['Scope', 'Priority'],
        steps: [
            {
                category: 'Scope',
                question: 'How big is this project?',
                options: [
                    { label: 'Quick task (< 1 hour)', desc: 'Small, focused deliverable' },
                    { label: 'Medium project (few hours)', desc: 'Multiple files, moderate complexity' },
                    { label: 'Large project (multi-day)', desc: 'Many components, full system' },
                ],
            },
            {
                category: 'Priority',
                question: 'What matters most?',
                options: [
                    { label: 'Speed — get it done fast', desc: 'MVP, working prototype quickly' },
                    { label: 'Quality — do it right', desc: 'Clean code, tests, documentation' },
                    { label: 'Design — make it beautiful', desc: 'Focus on UI/UX and visual polish' },
                    { label: 'Balanced', desc: 'Equal focus on all aspects' },
                ],
            },
        ],
    },
};

export class PlannerInterview {
    /**
     * @param {import('readline').Interface} rl — readline interface
     * @param {import('../providers/provider-manager.js').ProviderManager} [providers] — provider manager
     */
    constructor(rl, providers = null) {
        this.rl = rl;
        this.providers = providers;
        this.answers = {};
    }

    /**
     * Detect the best interview template for the given objective.
     * @param {string} objective
     * @returns {string} Template key
     */
    _detectTemplate(objective) {
        const lower = objective.toLowerCase();
        const webKeywords = ['website', 'web page', 'webpage', 'landing page', 'site', 'homepage', 'portfolio', 'blog'];
        const appKeywords = ['app', 'application', 'tool', 'system', 'platform', 'dashboard', 'api', 'server', 'cli', 'bot'];

        if (webKeywords.some(k => lower.includes(k))) return 'website';
        if (appKeywords.some(k => lower.includes(k))) return 'app';
        return 'general';
    }

    /**
     * Generate interview template using the LLM provider.
     * Produces prompt-specific questions that directly address the ambiguities
     * in the user's request — NOT generic "Interaction Goal / Detail Level" boilerplate.
     * @param {string} objective
     */
    async _generateDynamicTemplate(objective) {
        if (!this.providers) throw new Error('No providers available');
        const provider = this.providers.getProvider();
        if (!provider) throw new Error('No default provider available');

        const systemPrompt = `You are an expert software project manager conducting a pre-planning interview.

Your job: read the user's project objective.
First, decide if this is a large, ambiguous project (like building a new website, app, or major feature) that requires a planning interview.
If it is a small, clear task (like a targeted edit, quick refactor, bug fix, or simple question), output ONLY {"skipInterview": true}.

If it IS a large project, generate 2 SHORT, SPECIFIC clarifying questions that directly resolve the BIGGEST ambiguities in the request. The questions must change what gets built.

Rules:
- Questions must be SPECIFIC to this exact request — not generic boilerplate.
- Each category name is a 1-2 word label for the decision area (e.g. "Stack", "Scope", "Auth", "Style", "Data", "Deploy").
- Each question must target a real decision that affects implementation.
- Options must be concrete, mutually exclusive choices.
- Always include a "Let APES decide" option as the last option.
- NEVER generate generic questions like "What is your interaction goal?" or "What level of detail do you want?" — those are useless.
- Output ONLY valid JSON. No markdown fences, no extra text.

Output format if skipping interview:
{
  "skipInterview": true
}

Output format if interview is needed (exactly this structure):
{
  "skipInterview": false,
  "categories": ["Label1", "Label2"],
  "steps": [
    {
      "category": "Label1",
      "question": "Specific question about the most important decision?",
      "options": [
        { "label": "Concrete choice A", "desc": "What this means for the build" },
        { "label": "Concrete choice B", "desc": "What this means for the build" },
        { "label": "Let APES decide", "desc": "Auto-select the best option" }
      ]
    },
    {
      "category": "Label2",
      "question": "Specific question about the second most important decision?",
      "options": [
        { "label": "Concrete choice A", "desc": "What this means for the build" },
        { "label": "Concrete choice B", "desc": "What this means for the build" },
        { "label": "Let APES decide", "desc": "Auto-select the best option" }
      ]
    }
  ]
}`;

        const userMessage = `Project objective: ${objective}

Analyze this request. Do we skip the interview, or do we ask 2 clarifying questions? Output ONLY JSON.`;

        const response = await provider.generate({
            systemPrompt,
            userMessage,
            maxTokens: 1500,
            temperature: 0.5,
            responseFormat: 'json'
        });

        let jsonText = response.content.trim();
        // Strip markdown code fences if the model added them despite instructions
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        const template = JSON.parse(jsonText);

        if (template.skipInterview) {
            return template;
        }

        if (!template.categories || !template.steps || !Array.isArray(template.steps)) {
            throw new Error('Invalid template structure');
        }

        // Validate that questions are not generic boilerplate
        const genericPhrases = ['interaction goal', 'level of detail', 'detail level', 'what is your goal', 'communication style'];
        for (const step of template.steps) {
            const q = (step.question || '').toLowerCase();
            if (genericPhrases.some(p => q.includes(p))) {
                throw new Error('Generated generic questions — falling back to static template');
            }
        }

        return template;
    }

    /**
     * Run the full interactive interview.
     * @param {string} objective — The user's original prompt
     * @returns {Promise<{ skipped: boolean, context: string, answers: object }>}
     */
    async run(objective) {
        this.answers = {};

        let template;

        if (this.providers && this.providers.getProvider()) {
            process.stdout.write(`\n  ${c('dim', 'Analyzing task complexity... ')}`);
            try {
                template = await this._generateDynamicTemplate(objective);
                process.stdout.write(`\r\x1b[K  ${c('green', '✓')} ${c('dim', 'Task analyzed')}\n`);
            } catch (error) {
                process.stdout.write(`\r\x1b[K  ${c('yellow', '⚠')} ${c('yellow', `Failed dynamic analysis (${error.message}). Using default...`)}\n`);
                const templateKey = this._detectTemplate(objective);
                template = INTERVIEW_TEMPLATES[templateKey];
            }
        } else {
            const templateKey = this._detectTemplate(objective);
            template = INTERVIEW_TEMPLATES[templateKey];
        }

        // Check if LLM decided to skip interview for this straightforward task
        if (template.skipInterview) {
            console.log(`  ${c('dim', '  Skipping interview for straightforward task...')}`);
            return { skipped: true, context: '', answers: this.answers };
        }

        // Show entering plan mode
        console.log(`\n  ${c('green', '●')} ${c('bold', `I'll enter plan mode to design your project.`)}`);
        console.log(`  ${c('green', '●')} ${c('dim', 'Let me ask a few clarifying questions first.')}`);

        for (let stepIdx = 0; stepIdx < template.steps.length; stepIdx++) {
            const step = template.steps[stepIdx];

            // ─── Tab Bar ─────────────────────────────────────
            console.log('');
            const tabs = template.categories.map((cat, i) => {
                const done = i < stepIdx;
                const current = i === stepIdx;
                if (current) return `${c('inverse', ` ${c('bold', cat)} `)}`;
                if (done) return `${c('green', '✓')}${c('dim', cat)}`;
                return `${c('dim', '☐ ' + cat)}`;
            });

            // Arrows
            const leftArrow = stepIdx > 0 ? c('dim', '←') : ' ';
            const rightArrow = stepIdx < template.steps.length - 1 ? c('dim', '→') : ' ';
            console.log(`  ${leftArrow}  ${tabs.join('  ')}  ${rightArrow}`);

            // ─── Question ────────────────────────────────────
            console.log('');
            console.log(`  ${c('bold', c('white', step.question))}`);
            console.log('');

            // ─── Options ─────────────────────────────────────
            for (let i = 0; i < step.options.length; i++) {
                const opt = step.options[i];
                console.log(`  ${c('bold', c('cyan', `${i + 1}.`))} ${c('bold', opt.label)}`);
                console.log(`     ${c('dim', opt.desc)}`);
            }

            // Custom + skip options
            const customIdx = step.options.length + 1;
            const skipIdx = step.options.length + 2;
            console.log(`  ${c('bold', c('cyan', `${customIdx}.`))} ${c('dim', 'Type something custom.')}`);
            console.log('');
            console.log(`  ${c('bold', c('yellow', `${skipIdx}.`))} ${c('yellow', 'Skip interview and plan immediately')}`);
            console.log('');
            console.log(`  ${c('dim', 'Enter to select · Type number or custom answer')}`);

            // ─── Read Answer ─────────────────────────────────
            const answer = await this._ask(`  ${c('cyan', 'apes')} ${c('dim', `${step.category} ›`)} `);
            const trimmed = answer.trim();

            // Skip interview
            if (trimmed === String(skipIdx) || trimmed.toLowerCase() === 'skip') {
                console.log(`  ${c('dim', '  Skipping interview — planning immediately...')}`);
                return { skipped: true, context: '', answers: this.answers };
            }

            // Parse answer
            const num = parseInt(trimmed, 10);
            if (num >= 1 && num <= step.options.length) {
                this.answers[step.category] = step.options[num - 1].label;
                console.log(`  ${c('green', '✓')} ${c('dim', step.category + ':')} ${step.options[num - 1].label}`);
            } else if (num === customIdx || (trimmed.length > 0 && isNaN(num))) {
                // Custom answer
                let customText = trimmed;
                if (num === customIdx) {
                    customText = await this._ask(`  ${c('dim', 'Type your answer ›')} `);
                }
                this.answers[step.category] = customText;
                console.log(`  ${c('green', '✓')} ${c('dim', step.category + ':')} ${customText}`);
            } else {
                // Default: first option
                this.answers[step.category] = step.options[0].label;
                console.log(`  ${c('green', '✓')} ${c('dim', step.category + ':')} ${step.options[0].label} ${c('dim', '(default)')}`);
            }
        }

        // ─── Build enriched context ──────────────────────────
        const contextParts = [`Original objective: ${objective}`];
        for (const [key, value] of Object.entries(this.answers)) {
            contextParts.push(`${key}: ${value}`);
        }
        const context = contextParts.join('\n');

        console.log(`\n  ${c('green', '●')} ${c('dim', 'Interview complete. Generating plan...')}`);

        return { skipped: false, context, answers: this.answers };
    }

    /**
     * Ask a single question and return the answer.
     * @param {string} prompt
     * @returns {Promise<string>}
     */
    _ask(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, (answer) => {
                resolve(answer);
            });
        });
    }
}
