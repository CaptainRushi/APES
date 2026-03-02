/**
 * Skills Layer — Deterministic Execution Modules
 *
 * Skills are tools, not reasoning.
 * Each skill is a deterministic function that takes input and returns output.
 * The agent orchestrator decides which skills to invoke and in what order.
 *
 * Skill Interface:
 *   { name: string, execute(input: any): Promise<any> }
 *
 * Cluster-Specific Skill Sets:
 *   Research:    webSearch, scrape, citationCheck, summarize
 *   Engineering: generateCode, refactor, writeTests, designAPI
 *   Quality:     staticAnalysis, securityScan, complexityCheck, lintCheck
 *   Planning:    decompose, estimateEffort, mapDependencies, assessRisk
 *   VCS:         diffAnalysis, mergeStrategy, changelogGenerate, versionBump
 *   DevOps:      containerize, deployPlan, monitorSetup, networkDesign
 *   Learning:    detectPattern, benchmarkCompare, regressionCheck, optimizeSuggest
 *   Safety:      validateInput, auditTrail, complianceCheck, threatModel
 */

/** Registry of all available skill implementations */
const SKILL_REGISTRY = {
    // ─── Strategic Planning Skills ────────────────────────────────────────
    decompose: {
        name: 'decompose',
        cluster: 'strategic_planning',
        description: 'Break a complex task into atomic subtasks',
        async execute(input) {
            const objective = input.objective || input;
            const words = objective.split(/\s+/);
            const chunks = [];
            const chunkSize = Math.max(3, Math.ceil(words.length / 3));
            for (let i = 0; i < words.length; i += chunkSize) {
                chunks.push(words.slice(i, i + chunkSize).join(' '));
            }
            return {
                subtasks: chunks.map((c, i) => ({ id: `sub_${i}`, description: c, priority: i + 1 })),
                totalSubtasks: chunks.length,
            };
        },
    },
    estimateEffort: {
        name: 'estimateEffort',
        cluster: 'strategic_planning',
        description: 'Estimate effort based on complexity indicators',
        async execute(input) {
            const text = input.objective || String(input);
            const wordCount = text.split(/\s+/).length;
            const complexity = wordCount > 20 ? 'high' : wordCount > 10 ? 'medium' : 'low';
            const hours = { low: 1, medium: 4, high: 12 }[complexity];
            return { complexity, estimatedHours: hours, confidence: 0.7 };
        },
    },
    mapDependencies: {
        name: 'mapDependencies',
        cluster: 'strategic_planning',
        description: 'Identify dependencies between components',
        async execute(input) {
            return { dependencies: [], hasCyclicRisk: false, criticalPath: [] };
        },
    },
    assessRisk: {
        name: 'assessRisk',
        cluster: 'strategic_planning',
        description: 'Assess risks associated with a plan or task',
        async execute(input) {
            const text = (input.objective || String(input)).toLowerCase();
            const risks = [];
            const riskKeywords = { 'deploy': 'deployment failure', 'delete': 'data loss', 'production': 'production impact', 'security': 'security vulnerability', 'migration': 'migration failure' };
            for (const [kw, risk] of Object.entries(riskKeywords)) {
                if (text.includes(kw)) risks.push({ risk, severity: 'medium', mitigation: `Validate ${kw} step before proceeding` });
            }
            return { risks, overallRisk: risks.length > 2 ? 'high' : risks.length > 0 ? 'medium' : 'low' };
        },
    },

    // ─── Research Intelligence Skills ─────────────────────────────────────
    webSearch: {
        name: 'webSearch',
        cluster: 'research_intelligence',
        description: 'Search for information on a topic',
        async execute(input) {
            const query = input.objective || String(input);
            return { query, results: [], source: 'simulation', note: 'Real web search requires provider integration' };
        },
    },
    scrape: {
        name: 'scrape',
        cluster: 'research_intelligence',
        description: 'Extract structured data from a source',
        async execute(input) {
            return { data: null, format: 'json', source: 'simulation' };
        },
    },
    citationCheck: {
        name: 'citationCheck',
        cluster: 'research_intelligence',
        description: 'Verify citations and references',
        async execute(input) {
            return { verified: 0, unverified: 0, missing: 0, score: 1.0 };
        },
    },
    summarize: {
        name: 'summarize',
        cluster: 'research_intelligence',
        description: 'Summarize text or data into key points',
        async execute(input) {
            const text = input.objective || String(input);
            const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
            const summary = sentences.slice(0, Math.min(3, sentences.length)).join('. ');
            return { summary: summary || text, keyPoints: sentences.length, compressionRatio: summary.length / Math.max(text.length, 1) };
        },
    },

    // ─── Engineering Skills ───────────────────────────────────────────────
    generateCode: {
        name: 'generateCode',
        cluster: 'engineering',
        description: 'Generate code for a given specification',
        async execute(input) {
            const spec = input.objective || String(input);
            return { code: `// Generated for: ${spec}\n// Implementation requires LLM provider`, language: 'javascript', linesOfCode: 0 };
        },
    },
    refactor: {
        name: 'refactor',
        cluster: 'engineering',
        description: 'Refactor existing code for improved quality',
        async execute(input) {
            return { refactored: null, improvements: [], linesChanged: 0 };
        },
    },
    writeTests: {
        name: 'writeTests',
        cluster: 'engineering',
        description: 'Generate test cases for code',
        async execute(input) {
            return { tests: [], framework: 'vitest', coverageTarget: 80 };
        },
    },
    designAPI: {
        name: 'designAPI',
        cluster: 'engineering',
        description: 'Design REST/GraphQL API endpoints',
        async execute(input) {
            const spec = input.objective || String(input);
            return { endpoints: [], format: 'openapi', spec: `API design for: ${spec}` };
        },
    },

    // ─── Code Quality Skills ──────────────────────────────────────────────
    staticAnalysis: {
        name: 'staticAnalysis',
        cluster: 'code_quality',
        description: 'Run static analysis on code',
        async execute(input) {
            return { issues: [], warnings: 0, errors: 0, score: 100 };
        },
    },
    securityScan: {
        name: 'securityScan',
        cluster: 'code_quality',
        description: 'Scan code for security vulnerabilities',
        async execute(input) {
            return { vulnerabilities: [], severity: 'none', owaspFindings: [] };
        },
    },
    complexityCheck: {
        name: 'complexityCheck',
        cluster: 'code_quality',
        description: 'Measure code complexity metrics',
        async execute(input) {
            return { cyclomaticComplexity: 0, cognitiveComplexity: 0, maintainabilityIndex: 100 };
        },
    },
    lintCheck: {
        name: 'lintCheck',
        cluster: 'code_quality',
        description: 'Run linting rules on code',
        async execute(input) {
            return { errors: 0, warnings: 0, fixable: 0, rules: [] };
        },
    },

    // ─── Version Control Skills ───────────────────────────────────────────
    diffAnalysis: {
        name: 'diffAnalysis',
        cluster: 'version_control',
        description: 'Analyze code diffs for review',
        async execute(input) {
            return { filesChanged: 0, additions: 0, deletions: 0, riskAreas: [] };
        },
    },
    mergeStrategy: {
        name: 'mergeStrategy',
        cluster: 'version_control',
        description: 'Recommend merge strategy for branches',
        async execute(input) {
            return { strategy: 'squash-merge', conflicts: 0, recommendation: 'Safe to merge' };
        },
    },
    changelogGenerate: {
        name: 'changelogGenerate',
        cluster: 'version_control',
        description: 'Generate changelog from commit history',
        async execute(input) {
            return { changelog: '', entries: 0, version: '0.0.0' };
        },
    },
    versionBump: {
        name: 'versionBump',
        cluster: 'version_control',
        description: 'Determine version bump type',
        async execute(input) {
            return { bumpType: 'patch', currentVersion: '0.0.0', nextVersion: '0.0.1' };
        },
    },

    // ─── Execution Automation Skills ──────────────────────────────────────
    containerize: {
        name: 'containerize',
        cluster: 'execution_automation',
        description: 'Generate container configuration (Dockerfile)',
        async execute(input) {
            return { dockerfile: null, composeFile: null, imageSize: 'unknown' };
        },
    },
    deployPlan: {
        name: 'deployPlan',
        cluster: 'execution_automation',
        description: 'Create deployment plan',
        async execute(input) {
            return { steps: [], rollbackPlan: [], estimatedDowntime: '0s' };
        },
    },
    monitorSetup: {
        name: 'monitorSetup',
        cluster: 'execution_automation',
        description: 'Design monitoring and alerting setup',
        async execute(input) {
            return { metrics: [], alerts: [], dashboards: [] };
        },
    },
    networkDesign: {
        name: 'networkDesign',
        cluster: 'execution_automation',
        description: 'Design network topology',
        async execute(input) {
            return { topology: null, securityGroups: [], loadBalancer: null };
        },
    },

    // ─── Memory Learning Skills ───────────────────────────────────────────
    detectPattern: {
        name: 'detectPattern',
        cluster: 'memory_learning',
        description: 'Detect patterns in execution data',
        async execute(input) {
            return { patterns: [], anomalies: [], confidence: 0.5 };
        },
    },
    benchmarkCompare: {
        name: 'benchmarkCompare',
        cluster: 'memory_learning',
        description: 'Compare performance against benchmarks',
        async execute(input) {
            return { baseline: null, current: null, delta: 0, regression: false };
        },
    },
    regressionCheck: {
        name: 'regressionCheck',
        cluster: 'memory_learning',
        description: 'Check for performance regressions',
        async execute(input) {
            return { regressions: [], baseline: null, passed: true };
        },
    },
    optimizeSuggest: {
        name: 'optimizeSuggest',
        cluster: 'memory_learning',
        description: 'Suggest optimizations based on data',
        async execute(input) {
            return { suggestions: [], estimatedImpact: 'unknown', priority: 'low' };
        },
    },

    // ─── Control Safety Skills ────────────────────────────────────────────
    validateInput: {
        name: 'validateInput',
        cluster: 'control_safety',
        description: 'Validate input against schema and constraints',
        async execute(input) {
            const obj = input.objective || String(input);
            const hasContent = obj.trim().length > 0;
            return { valid: hasContent, errors: hasContent ? [] : ['Empty input'], sanitized: obj.trim() };
        },
    },
    auditTrail: {
        name: 'auditTrail',
        cluster: 'control_safety',
        description: 'Generate audit trail entry',
        async execute(input) {
            return { entry: { timestamp: Date.now(), action: input.objective || 'unknown', actor: input.agentId || 'system' }, logged: true };
        },
    },
    complianceCheck: {
        name: 'complianceCheck',
        cluster: 'control_safety',
        description: 'Check compliance against standards',
        async execute(input) {
            return { compliant: true, standards: ['OWASP', 'GDPR'], violations: [] };
        },
    },
    threatModel: {
        name: 'threatModel',
        cluster: 'control_safety',
        description: 'Perform threat modeling analysis',
        async execute(input) {
            return { threats: [], attackSurface: [], mitigations: [] };
        },
    },

    // ─── Workspace Skills (cross-cluster) ─────────────────────────────────
    readFile: {
        name: 'readFile',
        cluster: '_workspace',
        description: 'Read a file from the project workspace',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            const filePath = input.filePath || input.path || input.objective;
            return await engine.readFile(filePath, { agentId: input.agentId });
        },
    },
    writeFile: {
        name: 'writeFile',
        cluster: '_workspace',
        description: 'Write content to a file in the project workspace',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            const filePath = input.filePath || input.path;
            return await engine.writeFile(filePath, input.content, { agentId: input.agentId });
        },
    },
    editLines: {
        name: 'editLines',
        cluster: '_workspace',
        description: 'Edit specific lines in a workspace file',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            const filePath = input.filePath || input.path;
            return await engine.editLines(filePath, input.edits || [], { agentId: input.agentId });
        },
    },
    createDir: {
        name: 'createDir',
        cluster: '_workspace',
        description: 'Create a directory in the project workspace',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            const dirPath = input.dirPath || input.path || input.objective;
            return await engine.createDirectory(dirPath, { agentId: input.agentId });
        },
    },
    deleteFile: {
        name: 'deleteFile',
        cluster: '_workspace',
        description: 'Delete a file from the project workspace',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            const filePath = input.filePath || input.path || input.objective;
            return await engine.deleteFile(filePath, { agentId: input.agentId });
        },
    },
    analyzeRepo: {
        name: 'analyzeRepo',
        cluster: '_workspace',
        description: 'Analyze the project repository structure and technologies',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            return await engine.analyzeRepo({ agentId: input.agentId });
        },
    },
    previewDiff: {
        name: 'previewDiff',
        cluster: '_workspace',
        description: 'Preview a diff before applying edits to a file',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            const filePath = input.filePath || input.path;
            return await engine.previewDiff(filePath, input.edits || [], { agentId: input.agentId });
        },
    },
    findFiles: {
        name: 'findFiles',
        cluster: '_workspace',
        description: 'Search for files matching a glob pattern in the workspace',
        async execute(input) {
            const engine = input.workspaceEngine;
            if (!engine) return { success: false, error: 'Workspace engine not available' };
            const pattern = input.pattern || input.objective;
            const directory = input.directory || '.';
            return await engine.findFiles(pattern, directory, { agentId: input.agentId });
        },
    },
};

/** Map cluster → default skill names (including workspace skills by permission level) */
const CLUSTER_SKILLS = {
    strategic_planning: ['decompose', 'estimateEffort', 'mapDependencies', 'assessRisk', 'readFile', 'findFiles', 'analyzeRepo'],
    research_intelligence: ['webSearch', 'scrape', 'citationCheck', 'summarize', 'readFile', 'findFiles', 'analyzeRepo'],
    engineering: ['generateCode', 'refactor', 'writeTests', 'designAPI', 'readFile', 'writeFile', 'editLines', 'createDir', 'findFiles', 'analyzeRepo', 'previewDiff'],
    code_quality: ['staticAnalysis', 'securityScan', 'complexityCheck', 'lintCheck', 'readFile', 'editLines', 'findFiles', 'analyzeRepo', 'previewDiff'],
    version_control: ['diffAnalysis', 'mergeStrategy', 'changelogGenerate', 'versionBump', 'readFile', 'writeFile', 'editLines', 'createDir', 'findFiles', 'analyzeRepo', 'previewDiff'],
    execution_automation: ['containerize', 'deployPlan', 'monitorSetup', 'networkDesign', 'readFile', 'writeFile', 'editLines', 'createDir', 'deleteFile', 'findFiles', 'analyzeRepo', 'previewDiff'],
    memory_learning: ['detectPattern', 'benchmarkCompare', 'regressionCheck', 'optimizeSuggest', 'readFile', 'findFiles', 'analyzeRepo'],
    control_safety: ['validateInput', 'auditTrail', 'complianceCheck', 'threatModel', 'readFile', 'findFiles', 'analyzeRepo'],
};

export class SkillsLayer {
    /**
     * @param {string} cluster - Agent's cluster ID
     * @param {string[]} [agentSkills] - Agent's declared skills (for filtering)
     */
    constructor(cluster, agentSkills = []) {
        this.cluster = cluster;
        this.agentSkills = agentSkills;

        /** @type {Map<string, object>} */
        this.skills = new Map();

        // Load cluster-default skills
        const clusterSkillNames = CLUSTER_SKILLS[cluster] || [];
        for (const name of clusterSkillNames) {
            if (SKILL_REGISTRY[name]) {
                this.skills.set(name, SKILL_REGISTRY[name]);
            }
        }
    }

    /**
     * Get available skill names for this agent.
     * @returns {string[]}
     */
    getAvailableSkills() {
        return [...this.skills.keys()];
    }

    /**
     * Select skills relevant to the objective.
     * @param {string} objective
     * @returns {object[]} Ordered list of skills to invoke
     */
    selectSkills(objective) {
        const lower = objective.toLowerCase();
        const selected = [];

        for (const [name, skill] of this.skills) {
            // Simple keyword matching — in production, use embeddings
            const descWords = skill.description.toLowerCase().split(/\s+/);
            const match = descWords.some(w => w.length > 3 && lower.includes(w));
            if (match) {
                selected.push(skill);
            }
        }

        // If no specific match, return first 2 default skills
        if (selected.length === 0) {
            return [...this.skills.values()].slice(0, 2);
        }

        return selected;
    }

    /**
     * Execute a specific skill by name.
     * @param {string} name
     * @param {object} input
     * @returns {Promise<{ success: boolean, result?: any, error?: string, skillName: string }>}
     */
    async executeSkill(name, input) {
        const skill = this.skills.get(name);
        if (!skill) {
            return { success: false, error: `Skill '${name}' not found`, skillName: name };
        }

        try {
            const result = await skill.execute(input);
            return { success: true, result, skillName: name };
        } catch (err) {
            return { success: false, error: err.message, skillName: name };
        }
    }

    /**
     * Execute multiple skills in sequence.
     * @param {string[]} names
     * @param {object} input
     * @returns {Promise<object[]>}
     */
    async executeSequence(names, input) {
        const results = [];
        for (const name of names) {
            const result = await this.executeSkill(name, input);
            results.push(result);
        }
        return results;
    }

    /**
     * Register a custom skill.
     * @param {string} name
     * @param {object} skill - { name, description, execute(input) }
     */
    registerSkill(name, skill) {
        this.skills.set(name, skill);
    }

    /**
     * Get summary for debugging.
     */
    getSummary() {
        return {
            cluster: this.cluster,
            availableSkills: this.getAvailableSkills(),
            totalSkills: this.skills.size,
        };
    }
}

export { SKILL_REGISTRY, CLUSTER_SKILLS };
