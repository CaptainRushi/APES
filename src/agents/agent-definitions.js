/**
 * Agent Definitions — 64 Agents across 6 Layers (Swarm Architecture)
 *
 * Layer Architecture:
 *   1. Planning Layer         — system architect, dependency analysis, risk, refactor/performance/security planning
 *   2. Core Development Layer — backend, frontend, API, database, infrastructure, integration engineers
 *   3. Verification Layer     — unit tests, integration tests, static analysis, type validation
 *   4. Optimization Layer    — code optimization, memory optimization, concurrency optimization
 *   5. Enforcement Layer     — write/execution verification, snapshot, hash integrity, state, audit, rollback, consistency
 *   6. Documentation + DX    — documentation, API docs, developer experience
 *   7. Release Layer         — build management, CI validation, release management, final review
 */

export function getDefaultClusters() {
    return [
        {
            id: 'planning_layer',
            name: 'Planning Layer',
            description: 'System architect, dependency analysis, risk evaluation, refactor/performance/security planning',
        },
        {
            id: 'core_development',
            name: 'Core Development',
            description: 'Backend, frontend, API, database, infrastructure, integration engineers',
        },
        {
            id: 'verification_layer',
            name: 'Verification Layer',
            description: 'Unit tests, integration tests, static analysis, type validation',
        },
        {
            id: 'optimization_layer',
            name: 'Optimization Layer',
            description: 'Code optimization, memory optimization, concurrency optimization',
        },
        {
            id: 'enforcement_layer',
            name: 'Enforcement Layer',
            description: 'Write/execution verification, snapshot, hash integrity, state, audit, rollback, consistency',
        },
        {
            id: 'documentation_dx',
            name: 'Documentation + DX',
            description: 'Documentation writers, API docs generators, developer experience improvers',
        },
        {
            id: 'release_layer',
            name: 'Release Layer',
            description: 'Build management, CI validation, release management, final review',
        },
    ];
}

/**
 * Workspace permission presets keyed by cluster.
 * These are the default file-system capabilities for each cluster's agents.
 */
const WORKSPACE_PERMISSIONS = {
    planning_layer: { read: true, write: true, edit: true, delete: false },
    core_development: { read: true, write: true, edit: true, delete: false },
    verification_layer: { read: true, write: true, edit: true, delete: false },
    optimization_layer: { read: true, write: true, edit: true, delete: false },
    enforcement_layer: { read: true, write: true, edit: true, delete: true },
    documentation_dx: { read: true, write: true, edit: true, delete: false },
    release_layer: { read: true, write: true, edit: true, delete: false },
};

export function getDefaultAgents() {
    return [
        // ═══════════════════════════════════════════════════════════════════════
        // PLANNING LAYER (8 agents)
        // ═══════════════════════════════════════════════════════════════════════
        
        // 1. System Architect
        {
            id: 'system_architect_v1',
            role: 'system_architect',
            cluster: 'planning_layer',
            skills: ['system-design', 'architecture', 'scalability', 'microservices', 'trade-off-analysis'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.92,
            avgExecutionTime: 4.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },
        // 2. Dependency Analyzer
        {
            id: 'dependency_analyzer_v1',
            role: 'dependency_analyzer',
            cluster: 'planning_layer',
            skills: ['dependency-graph', 'vulnerability-scan', 'circular-deps', 'version-resolution'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },
        // 3. Risk Evaluator
        {
            id: 'risk_evaluator_v1',
            role: 'risk_evaluator',
            cluster: 'planning_layer',
            skills: ['risk-assessment', 'threat-modeling', 'mitigation', 'failure-analysis'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.85,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },
        // 4. Refactor Planner
        {
            id: 'refactor_planner_v1',
            role: 'refactor_planner',
            cluster: 'planning_layer',
            skills: ['refactoring', 'code-smells', 'design-patterns', 'technical-debt'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.86,
            avgExecutionTime: 2.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },
        // 5. Performance Planner
        {
            id: 'performance_planner_v1',
            role: 'performance_planner',
            cluster: 'planning_layer',
            skills: ['profiling', 'bottleneck-analysis', 'optimization-strategy', 'capacity-planning'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 3.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },
        // 6. Security Planner
        {
            id: 'security_planner_v1',
            role: 'security_planner',
            cluster: 'planning_layer',
            skills: ['security-architecture', 'threat-modeling', 'compliance', 'encryption-strategy'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.89,
            avgExecutionTime: 3.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },
        // 7. Enforcement Planner
        {
            id: 'enforcement_planner_v1',
            role: 'enforcement_planner',
            cluster: 'planning_layer',
            skills: ['constraint-enforcement', 'policy-engineering', 'guardrails', 'validation-rules'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.84,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },
        // 8. Test Strategy Planner
        {
            id: 'test_strategy_planner_v1',
            role: 'test_strategy_planner',
            cluster: 'planning_layer',
            skills: ['test-planning', 'coverage-strategy', 'test-pyramid', 'automation-strategy'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.86,
            avgExecutionTime: 2.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.planning_layer,
        },

        // ═══════════════════════════════════════════════════════════════════════
        // CORE DEVELOPMENT LAYER (16 agents)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Backend Engineers x4
        {
            id: 'backend_engineer_1_v1',
            role: 'backend_engineer',
            cluster: 'core_development',
            skills: ['nodejs', 'express', 'api', 'rest', 'typescript'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.90,
            avgExecutionTime: 3.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'backend_engineer_2_v1',
            role: 'backend_engineer',
            cluster: 'core_development',
            skills: ['python', 'django', 'fastapi', 'graphql', 'async'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.89,
            avgExecutionTime: 3.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'backend_engineer_3_v1',
            role: 'backend_engineer',
            cluster: 'core_development',
            skills: ['go', 'gin', 'grpc', 'microservices', 'concurrency'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 3.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'backend_engineer_4_v1',
            role: 'backend_engineer',
            cluster: 'core_development',
            skills: ['java', 'spring-boot', 'kotlin', 'jpa', 'maven'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 3.4,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        
        // Frontend Engineers x4
        {
            id: 'frontend_engineer_1_v1',
            role: 'frontend_engineer',
            cluster: 'core_development',
            skills: ['react', 'typescript', 'css', 'responsive-design', 'hooks'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.91,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'frontend_engineer_2_v1',
            role: 'frontend_engineer',
            cluster: 'core_development',
            skills: ['vue', 'vuex', 'typescript', 'vite', 'composition-api'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.89,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'frontend_engineer_3_v1',
            role: 'frontend_engineer',
            cluster: 'core_development',
            skills: ['angular', 'rxjs', 'typescript', 'ngrx', 'material'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 3.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'frontend_engineer_4_v1',
            role: 'frontend_engineer',
            cluster: 'core_development',
            skills: ['nextjs', 'ssr', 'api-routes', 'tailwind', 'framer-motion'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 3.1,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        
        // API Engineers x2
        {
            id: 'api_engineer_1_v1',
            role: 'api_engineer',
            cluster: 'core_development',
            skills: ['rest', 'openapi', 'authentication', 'rate-limiting', 'caching'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.90,
            avgExecutionTime: 2.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'api_engineer_2_v1',
            role: 'api_engineer',
            cluster: 'core_development',
            skills: ['graphql', 'apollo', 'federation', 'subscriptions', 'nexus'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        
        // Database Engineers x2
        {
            id: 'database_engineer_1_v1',
            role: 'database_engineer',
            cluster: 'core_development',
            skills: ['postgresql', 'mysql', 'sql', 'migration', 'replication'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.89,
            avgExecutionTime: 3.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'database_engineer_2_v1',
            role: 'database_engineer',
            cluster: 'core_development',
            skills: ['mongodb', 'redis', 'nosql', 'caching', 'sharding'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 2.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        
        // Infrastructure Engineers x2
        {
            id: 'infrastructure_engineer_1_v1',
            role: 'infrastructure_engineer',
            cluster: 'core_development',
            skills: ['aws', 'ec2', 's3', 'lambda', 'cloudformation'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 4.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'infrastructure_engineer_2_v1',
            role: 'infrastructure_engineer',
            cluster: 'core_development',
            skills: ['kubernetes', 'docker', 'helm', 'terraform', 'istio'],
            complexitySupported: ['complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 4.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        
        // Integration Engineers x2
        {
            id: 'integration_engineer_1_v1',
            role: 'integration_engineer',
            cluster: 'core_development',
            skills: ['webhook', 'api-integration', 'third-party', 'event-bus'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.86,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },
        {
            id: 'integration_engineer_2_v1',
            role: 'integration_engineer',
            cluster: 'core_development',
            skills: ['message-queue', 'kafka', 'rabbitmq', 'event-sourcing', 'cqrs'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.85,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.core_development,
        },

        // ═══════════════════════════════════════════════════════════════════════
        // VERIFICATION LAYER (12 agents)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Unit Test Generators x4
        {
            id: 'unit_test_generator_1_v1',
            role: 'unit_test_generator',
            cluster: 'verification_layer',
            skills: ['jest', 'unit-testing', 'mocking', 'tdd'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'unit_test_generator_2_v1',
            role: 'unit_test_generator',
            cluster: 'verification_layer',
            skills: ['pytest', 'unittest', 'fixture', 'parameterized'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'unit_test_generator_3_v1',
            role: 'unit_test_generator',
            cluster: 'verification_layer',
            skills: ['junit', 'testng', 'mockito', 'assertj'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.86,
            avgExecutionTime: 2.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'unit_test_generator_4_v1',
            role: 'unit_test_generator',
            cluster: 'verification_layer',
            skills: ['vitest', 'testing-library', 'react-testing', 'coverage'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 1.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        
        // Integration Testers x4
        {
            id: 'integration_tester_1_v1',
            role: 'integration_tester',
            cluster: 'verification_layer',
            skills: ['supertest', 'api-testing', 'end-to-end', 'cypress'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'integration_tester_2_v1',
            role: 'integration_tester',
            cluster: 'verification_layer',
            skills: ['playwright', 'puppeteer', 'e2e', 'visual-testing'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 2.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'integration_tester_3_v1',
            role: 'integration_tester',
            cluster: 'verification_layer',
            skills: ['postman', 'newman', 'api-collection', 'integration'],
            complexitySupported: ['simple', 'medium'],
            confidenceScore: 0.85,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'integration_tester_4_v1',
            role: 'integration_tester',
            cluster: 'verification_layer',
            skills: ['testcontainers', 'docker-integration', 'database-testing', 'integration'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.84,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        
        // Static Analyzers x2
        {
            id: 'static_analyzer_1_v1',
            role: 'static_analyzer',
            cluster: 'verification_layer',
            skills: ['eslint', 'sonarqube', 'code-quality', 'linting'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.90,
            avgExecutionTime: 1.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'static_analyzer_2_v1',
            role: 'static_analyzer',
            cluster: 'verification_layer',
            skills: ['semgrep', 'bandit', 'security-scan', 'vulnerability-detection'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        
        // Type Validators x2
        {
            id: 'type_validator_1_v1',
            role: 'type_validator',
            cluster: 'verification_layer',
            skills: ['typescript', 'type-checking', 'generics', 'infer'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.91,
            avgExecutionTime: 1.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },
        {
            id: 'type_validator_2_v1',
            role: 'type_validator',
            cluster: 'verification_layer',
            skills: ['flow', 'prop-types', 'runtime-validation', 'schema-validation'],
            complexitySupported: ['simple', 'medium'],
            confidenceScore: 0.85,
            avgExecutionTime: 1.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.verification_layer,
        },

        // ═══════════════════════════════════════════════════════════════════════
        // REFACTOR & OPTIMIZATION LAYER (8 agents)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Code Optimizers x4
        {
            id: 'code_optimizer_1_v1',
            role: 'code_optimizer',
            cluster: 'optimization_layer',
            skills: ['refactoring', 'clean-code', 'design-patterns', 'performance'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },
        {
            id: 'code_optimizer_2_v1',
            role: 'code_optimizer',
            cluster: 'optimization_layer',
            skills: ['bundle-optimization', 'tree-shaking', 'code-splitting', 'minification'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },
        {
            id: 'code_optimizer_3_v1',
            role: 'code_optimizer',
            cluster: 'optimization_layer',
            skills: ['algorithm-optimization', 'time-complexity', 'space-complexity', 'data-structures'],
            complexitySupported: ['complex'],
            confidenceScore: 0.89,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },
        {
            id: 'code_optimizer_4_v1',
            role: 'code_optimizer',
            cluster: 'optimization_layer',
            skills: ['query-optimization', 'sql-tuning', 'indexing', 'database-performance'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.86,
            avgExecutionTime: 2.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },
        
        // Memory Optimizers x2
        {
            id: 'memory_optimizer_1_v1',
            role: 'memory_optimizer',
            cluster: 'optimization_layer',
            skills: ['memory-leak-detection', 'profiling', 'garbage-collection', 'heap-analysis'],
            complexitySupported: ['complex'],
            confidenceScore: 0.85,
            avgExecutionTime: 3.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },
        {
            id: 'memory_optimizer_2_v1',
            role: 'memory_optimizer',
            cluster: 'optimization_layer',
            skills: ['caching', 'object-pooling', 'buffer-optimization', 'memory-mgmt'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.84,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },
        
        // Concurrency Optimizers x2
        {
            id: 'concurrency_optimizer_1_v1',
            role: 'concurrency_optimizer',
            cluster: 'optimization_layer',
            skills: ['async', 'parallelism', 'thread-pool', 'promise-optimization'],
            complexitySupported: ['complex'],
            confidenceScore: 0.86,
            avgExecutionTime: 3.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },
        {
            id: 'concurrency_optimizer_2_v1',
            role: 'concurrency_optimizer',
            cluster: 'optimization_layer',
            skills: ['worker-threads', 'cluster', 'load-balancing', 'distributed-systems'],
            complexitySupported: ['complex'],
            confidenceScore: 0.85,
            avgExecutionTime: 3.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.optimization_layer,
        },

        // ═══════════════════════════════════════════════════════════════════════
        // ENFORCEMENT LAYER (8 agents)
        // ═══════════════════════════════════════════════════════════════════════
        
        // 1. Write Verifier
        {
            id: 'write_verifier_v1',
            role: 'write_verifier',
            cluster: 'enforcement_layer',
            skills: ['file-write-verification', 'atomic-writes', 'fsync', 'integrity-check'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.92,
            avgExecutionTime: 0.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },
        // 2. Execution Verifier
        {
            id: 'execution_verifier_v1',
            role: 'execution_verifier',
            cluster: 'enforcement_layer',
            skills: ['execution-validation', 'state-verification', 'result-checking', 'verification'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.91,
            avgExecutionTime: 1.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },
        // 3. Snapshot Comparator
        {
            id: 'snapshot_comparator_v1',
            role: 'snapshot_comparator',
            cluster: 'enforcement_layer',
            skills: ['snapshot', 'diff', 'comparison', 'change-detection'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.90,
            avgExecutionTime: 1.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },
        // 4. Hash Integrity Guard
        {
            id: 'hash_integrity_guard_v1',
            role: 'hash_integrity_guard',
            cluster: 'enforcement_layer',
            skills: ['hash-validation', 'checksum', 'integrity', 'tamper-detection'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.93,
            avgExecutionTime: 0.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },
        // 5. State Validator
        {
            id: 'state_validator_v1',
            role: 'state_validator',
            cluster: 'enforcement_layer',
            skills: ['state-validation', 'consistency-check', 'invariant-checking', 'rollback'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.89,
            avgExecutionTime: 1.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },
        // 6. Audit Logger
        {
            id: 'audit_logger_v1',
            role: 'audit_logger',
            cluster: 'enforcement_layer',
            skills: ['audit-trail', 'logging', 'compliance', 'traceability'],
            complexitySupported: ['simple', 'medium'],
            confidenceScore: 0.91,
            avgExecutionTime: 0.6,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },
        // 7. Rollback Manager
        {
            id: 'rollback_manager_v1',
            role: 'rollback_manager',
            cluster: 'enforcement_layer',
            skills: ['rollback', 'transaction-reversal', 'state-recovery', 'checkpoint'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },
        // 8. Consistency Checker
        {
            id: 'consistency_checker_v1',
            role: 'consistency_checker',
            cluster: 'enforcement_layer',
            skills: ['consistency', 'data-integrity', 'constraint-validation', 'sync'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.90,
            avgExecutionTime: 1.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.enforcement_layer,
        },

        // ═══════════════════════════════════════════════════════════════════════
        // DOCUMENTATION + DX LAYER (6 agents)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Documentation Writers x2
        {
            id: 'documentation_writer_1_v1',
            role: 'documentation_writer',
            cluster: 'documentation_dx',
            skills: ['readme', 'guides', 'tutorials', 'markdown'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.documentation_dx,
        },
        {
            id: 'documentation_writer_2_v1',
            role: 'documentation_writer',
            cluster: 'documentation_dx',
            skills: ['code-documentation', 'javadoc', 'jsdoc', 'inline-docs'],
            complexitySupported: ['simple', 'medium'],
            confidenceScore: 0.85,
            avgExecutionTime: 1.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.documentation_dx,
        },
        
        // API Docs Generators x2
        {
            id: 'api_docs_generator_1_v1',
            role: 'api_docs_generator',
            cluster: 'documentation_dx',
            skills: ['openapi', 'swagger', 'api-documentation', 'rest-docs'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 1.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.documentation_dx,
        },
        {
            id: 'api_docs_generator_2_v1',
            role: 'api_docs_generator',
            cluster: 'documentation_dx',
            skills: ['graphql-docs', 'typedoc', 'api-reference', 'interactive-docs'],
            complexitySupported: ['simple', 'medium'],
            confidenceScore: 0.86,
            avgExecutionTime: 1.6,
            workspacePermissions: WORKSPACE_PERMISSIONS.documentation_dx,
        },
        
        // Dev Experience Improvers x2
        {
            id: 'dev_experience_improver_1_v1',
            role: 'dev_experience_improver',
            cluster: 'documentation_dx',
            skills: ['cli-tools', 'developer-tools', 'dx', 'productivity'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.85,
            avgExecutionTime: 2.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.documentation_dx,
        },
        {
            id: 'dev_experience_improver_2_v1',
            role: 'dev_experience_improver',
            cluster: 'documentation_dx',
            skills: ['scaffolding', 'boilerplate', 'templates', 'codegen'],
            complexitySupported: ['simple', 'medium'],
            confidenceScore: 0.84,
            avgExecutionTime: 1.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.documentation_dx,
        },

        // ═══════════════════════════════════════════════════════════════════════
        // RELEASE LAYER (6 agents)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Build Managers x2
        {
            id: 'build_manager_1_v1',
            role: 'build_manager',
            cluster: 'release_layer',
            skills: ['webpack', 'vite', 'rollup', 'build-optimization'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.release_layer,
        },
        {
            id: 'build_manager_2_v1',
            role: 'build_manager',
            cluster: 'release_layer',
            skills: ['gradle', 'maven', 'make', 'build-automation'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.86,
            avgExecutionTime: 3.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.release_layer,
        },
        
        // CI Validators x2
        {
            id: 'ci_validator_1_v1',
            role: 'ci_validator',
            cluster: 'release_layer',
            skills: ['github-actions', 'github-actions', 'workflow', 'ci-pipeline'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.89,
            avgExecutionTime: 2.0,
            workspacePermissions: WORKSPACE_PERMISSIONS.release_layer,
        },
        {
            id: 'ci_validator_2_v1',
            role: 'ci_validator',
            cluster: 'release_layer',
            skills: ['jenkins', 'gitlab-ci', 'circleci', 'ci-configuration'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 2.5,
            workspacePermissions: WORKSPACE_PERMISSIONS.release_layer,
        },
        
        // Release Manager x1
        {
            id: 'release_manager_v1',
            role: 'release_manager',
            cluster: 'release_layer',
            skills: ['semver', 'changelog', 'release-notes', 'versioning'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.88,
            avgExecutionTime: 1.8,
            workspacePermissions: WORKSPACE_PERMISSIONS.release_layer,
        },
        
        // Final Reviewer x1
        {
            id: 'final_reviewer_v1',
            role: 'final_reviewer',
            cluster: 'release_layer',
            skills: ['final-review', 'quality-gate', 'release-approval', 'sign-off'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.90,
            avgExecutionTime: 2.2,
            workspacePermissions: WORKSPACE_PERMISSIONS.release_layer,
        },
    ];
}

export { WORKSPACE_PERMISSIONS };

/**
 * Legacy cluster ID → new cluster ID mapping.
 * Used for backward compatibility with old 6-cluster/8-cluster references.
 */
export const LEGACY_CLUSTER_MAP = {
    // Old 8-cluster system
    research: 'planning_layer',
    coding: 'core_development',
    devops: 'core_development',
    uiux: 'core_development',
    analysis: 'optimization_layer',
    evaluation: 'verification_layer',
    // Old 6-cluster system (if any)
    planning: 'planning_layer',
    engineering: 'core_development',
    verification: 'verification_layer',
    optimization: 'optimization_layer',
    enforcement: 'enforcement_layer',
    documentation: 'documentation_dx',
    release: 'release_layer',
};
