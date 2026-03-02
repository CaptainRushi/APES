/**
 * Intent Classifier
 *
 * Stage 2 of the Cognitive Pipeline.
 * Classifies user input into intent categories to guide
 * task decomposition and agent selection.
 *
 * 8 intent types mapping to 8 clusters:
 *   planning  → strategic_planning
 *   research  → research_intelligence
 *   code      → engineering
 *   quality   → code_quality
 *   vcs       → version_control
 *   devops    → execution_automation
 *   learning  → memory_learning
 *   safety    → control_safety
 */

export class IntentClassifier {
    constructor() {
        /**
         * Intent patterns — keyword-based classification.
         * In production, this would be backed by an LLM or embedding model.
         */
        this.patterns = new Map([
            ['planning', {
                keywords: ['plan', 'architecture', 'design system', 'roadmap', 'strategy', 'structure', 'organize', 'breakdown', 'decompose', 'requirements', 'estimate', 'scope', 'milestone', 'integration'],
                cluster: 'strategic_planning',
                priority: 'medium',
            }],
            ['research', {
                keywords: ['research', 'find', 'search', 'look up', 'investigate', 'analyze', 'compare', 'what is', 'how does', 'explain', 'understand', 'documentation', 'explore', 'survey'],
                cluster: 'research_intelligence',
                priority: 'medium',
            }],
            ['code', {
                keywords: ['build', 'create', 'implement', 'code', 'write', 'develop', 'function', 'class', 'api', 'endpoint', 'component', 'module', 'frontend', 'backend', 'fullstack', 'database'],
                cluster: 'engineering',
                priority: 'high',
            }],
            ['quality', {
                keywords: ['review', 'debug', 'fix', 'bug', 'refactor', 'lint', 'test', 'coverage', 'quality', 'clean', 'improve', 'type-check', 'standards'],
                cluster: 'code_quality',
                priority: 'high',
            }],
            ['vcs', {
                keywords: ['git', 'branch', 'merge', 'commit', 'pull request', 'pr', 'release', 'version', 'changelog', 'ci', 'pipeline', 'dependency', 'upgrade', 'migration'],
                cluster: 'version_control',
                priority: 'medium',
            }],
            ['devops', {
                keywords: ['deploy', 'docker', 'kubernetes', 'ci/cd', 'server', 'cloud', 'aws', 'infrastructure', 'monitor', 'scale', 'container', 'terraform', 'networking', 'load-balance'],
                cluster: 'execution_automation',
                priority: 'high',
            }],
            ['learning', {
                keywords: ['optimize', 'pattern', 'performance', 'benchmark', 'profile', 'evaluate', 'metrics', 'analytics', 'trend', 'regression', 'baseline'],
                cluster: 'memory_learning',
                priority: 'medium',
            }],
            ['safety', {
                keywords: ['security', 'audit', 'vulnerability', 'compliance', 'validate', 'sanitize', 'authentication', 'authorization', 'encrypt', 'permission', 'owasp', 'gdpr'],
                cluster: 'control_safety',
                priority: 'high',
            }],
        ]);
    }

    /**
     * Classify parsed input into an intent
     * @param {object} parsed - Parsed input from Stage 1
     * @returns {{ type: string, cluster: string, confidence: number, matched: string[] }}
     */
    classify(parsed) {
        const inputLower = parsed.raw.toLowerCase();
        const scores = [];

        for (const [intentType, pattern] of this.patterns) {
            const matched = pattern.keywords.filter(kw => inputLower.includes(kw));
            if (matched.length > 0) {
                scores.push({
                    type: intentType,
                    cluster: pattern.cluster,
                    priority: pattern.priority,
                    confidence: Math.min(matched.length / 3, 1.0), // Normalize to 0-1
                    matched,
                });
            }
        }

        // Sort by confidence descending
        scores.sort((a, b) => b.confidence - a.confidence);

        if (scores.length === 0) {
            return {
                type: 'general',
                cluster: 'research_intelligence',
                confidence: 0.3,
                matched: [],
                secondary: [],
            };
        }

        // Return primary intent with secondary intents
        return {
            ...scores[0],
            secondary: scores.slice(1).map(s => ({ type: s.type, cluster: s.cluster, confidence: s.confidence })),
        };
    }
}
