/**
 * Intent Classifier
 * 
 * Stage 2 of the Cognitive Pipeline.
 * Classifies user input into intent categories to guide
 * task decomposition and agent selection.
 */

export class IntentClassifier {
    constructor() {
        /**
         * Intent patterns — keyword-based classification.
         * In production, this would be backed by an LLM or embedding model.
         */
        this.patterns = new Map([
            ['code', {
                keywords: ['build', 'create', 'implement', 'code', 'write', 'develop', 'function', 'class', 'api', 'endpoint', 'component', 'module', 'refactor', 'fix', 'bug', 'debug'],
                cluster: 'coding',
                priority: 'high',
            }],
            ['research', {
                keywords: ['research', 'find', 'search', 'look up', 'investigate', 'analyze', 'compare', 'what is', 'how does', 'explain', 'understand'],
                cluster: 'research',
                priority: 'medium',
            }],
            ['devops', {
                keywords: ['deploy', 'docker', 'kubernetes', 'ci/cd', 'pipeline', 'server', 'cloud', 'aws', 'infrastructure', 'monitor', 'scale', 'container'],
                cluster: 'devops',
                priority: 'high',
            }],
            ['design', {
                keywords: ['design', 'ui', 'ux', 'layout', 'style', 'theme', 'color', 'responsive', 'animation', 'interface', 'mockup', 'wireframe'],
                cluster: 'uiux',
                priority: 'medium',
            }],
            ['analysis', {
                keywords: ['analyze', 'evaluate', 'report', 'metrics', 'performance', 'benchmark', 'test', 'audit', 'review', 'optimize', 'profile'],
                cluster: 'analysis',
                priority: 'medium',
            }],
            ['planning', {
                keywords: ['plan', 'architecture', 'design system', 'roadmap', 'strategy', 'structure', 'organize', 'breakdown', 'decompose'],
                cluster: 'research',
                priority: 'low',
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
                cluster: 'research',
                confidence: 0.3,
                matched: [],
                secondary: [],
            };
        }

        // Return primary intent with secondary intents
        return {
            ...scores[0],
            secondary: scores.slice(1).map(s => ({ type: s.type, confidence: s.confidence })),
        };
    }
}
