/**
 * PermissionGuard — Agent-level permission enforcement
 *
 * Controls which agents can perform which workspace actions.
 * Enforces:
 *   1. Path scoping (no access outside projectRoot)
 *   2. Path traversal prevention
 *   3. Per-cluster permission levels
 *   4. Sensitive file protection (.env, credentials, etc.)
 *   5. Read-only mode enforcement
 */

import { resolve, relative, sep } from 'node:path';

const CLUSTER_PERMISSIONS = {
  engineering:           { read: true, write: true,  edit: true,  delete: false },
  code_quality:          { read: true, write: false, edit: true,  delete: false },
  research_intelligence: { read: true, write: false, edit: false, delete: false },
  strategic_planning:    { read: true, write: false, edit: false, delete: false },
  version_control:       { read: true, write: true,  edit: true,  delete: false },
  execution_automation:  { read: true, write: true,  edit: true,  delete: true  },
  memory_learning:       { read: true, write: false, edit: false, delete: false },
  control_safety:        { read: true, write: false, edit: false, delete: false },
};

const PROTECTED_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /credentials/i,
  /secrets/i,
  /\.ssh/,
  /\.git[/\\]config$/,
  /node_modules[/\\]/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /\.npmrc$/,
  /\.pypirc$/,
];

export class PermissionGuard {
  constructor(projectRoot, options = {}) {
    this.projectRoot = resolve(projectRoot);
    this._overrides = new Map();
    this._readOnlyMode = options.readOnlyMode || false;
    this._agentClusterMap = new Map();
  }

  checkPermission(agentId, action, filePath) {
    // Read-only mode blocks all mutations
    if (this._readOnlyMode && action !== 'read') {
      return { allowed: false, reason: 'Workspace is in read-only mode' };
    }

    // Validate path
    const pathCheck = this.validatePath(filePath);
    if (!pathCheck.valid) {
      return { allowed: false, reason: pathCheck.reason };
    }

    // Protected file check (for write/edit/delete)
    if (action !== 'read') {
      const protCheck = this.checkProtectedFile(pathCheck.resolved);
      if (protCheck.protected) {
        return { allowed: false, reason: `Protected file pattern: ${protCheck.pattern}` };
      }
    }

    // Check agent-level override first
    if (this._overrides.has(agentId)) {
      const override = this._overrides.get(agentId);
      if (override[action] === true) return { allowed: true };
      if (override[action] === false) {
        return { allowed: false, reason: `Agent ${agentId} explicitly denied ${action}` };
      }
    }

    // Check cluster permission
    const clusterCheck = this.checkClusterPermission(agentId, action);
    return clusterCheck;
  }

  validatePath(filePath) {
    try {
      const resolved = resolve(this.projectRoot, filePath);
      // Normalize for comparison — ensure projectRoot prefix match
      const normalizedResolved = resolved.split(sep).join('/');
      const normalizedRoot = this.projectRoot.split(sep).join('/');
      if (!normalizedResolved.startsWith(normalizedRoot + '/') && normalizedResolved !== normalizedRoot) {
        return { valid: false, reason: 'Path escapes project root' };
      }
      return { valid: true, resolved };
    } catch (err) {
      return { valid: false, reason: `Invalid path: ${err.message}` };
    }
  }

  checkProtectedFile(resolvedPath) {
    const rel = relative(this.projectRoot, resolvedPath).replace(/\\/g, '/');
    for (const pattern of PROTECTED_PATTERNS) {
      if (pattern.test(rel) || pattern.test(resolvedPath)) {
        return { protected: true, pattern: pattern.toString() };
      }
    }
    return { protected: false };
  }

  checkClusterPermission(agentId, action) {
    const cluster = this._resolveCluster(agentId);
    if (!cluster) {
      return { allowed: false, reason: `Unknown agent cluster for ${agentId}` };
    }
    const perms = CLUSTER_PERMISSIONS[cluster];
    if (!perms) {
      return { allowed: false, reason: `No permissions defined for cluster ${cluster}` };
    }
    if (perms[action] === true) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Cluster ${cluster} does not have ${action} permission` };
  }

  registerAgentCluster(agentId, cluster) {
    this._agentClusterMap.set(agentId, cluster);
  }

  grantOverride(agentId, permissions) {
    this._overrides.set(agentId, { ...permissions });
  }

  revokeOverride(agentId) {
    this._overrides.delete(agentId);
  }

  setReadOnlyMode(enabled) {
    this._readOnlyMode = enabled;
  }

  getSummary() {
    return {
      projectRoot: this.projectRoot,
      readOnlyMode: this._readOnlyMode,
      overrideCount: this._overrides.size,
      registeredAgents: this._agentClusterMap.size,
      clusterPermissions: { ...CLUSTER_PERMISSIONS },
    };
  }

  _resolveCluster(agentId) {
    // Check explicit mapping
    if (this._agentClusterMap.has(agentId)) {
      return this._agentClusterMap.get(agentId);
    }
    // Infer from agent ID conventions (e.g., backend_v1 → engineering)
    const clusterPrefixes = {
      architect: 'strategic_planning', strategic_planner: 'strategic_planning',
      task_decomposer: 'strategic_planning', risk_analyst: 'strategic_planning',
      requirements: 'strategic_planning', effort_estimator: 'strategic_planning',
      integration_planner: 'strategic_planning', decision_analyst: 'strategic_planning',
      researcher: 'research_intelligence', data_analyst: 'research_intelligence',
      domain_expert: 'research_intelligence', technical_writer: 'research_intelligence',
      competitive: 'research_intelligence', knowledge_miner: 'research_intelligence',
      api_researcher: 'research_intelligence', literature: 'research_intelligence',
      backend: 'engineering', frontend: 'engineering', fullstack: 'engineering',
      database: 'engineering', systems: 'engineering', mobile: 'engineering',
      api_engineer: 'engineering', ux_designer: 'engineering',
      code_reviewer: 'code_quality', debugger: 'code_quality', refactorer: 'code_quality',
      lint: 'code_quality', test_engineer: 'code_quality', test_generator: 'code_quality',
      type_checker: 'code_quality', doc_reviewer: 'code_quality',
      git: 'version_control', ci_engineer: 'version_control', release: 'version_control',
      pr_reviewer: 'version_control', branch: 'version_control', migration: 'version_control',
      dependency: 'version_control', monorepo: 'version_control',
      devops: 'execution_automation', infrastructure: 'execution_automation',
      container: 'execution_automation', cloud: 'execution_automation',
      monitoring: 'execution_automation', automation: 'execution_automation',
      network: 'execution_automation', sre: 'execution_automation',
      meta_evaluator: 'memory_learning', pattern_detector: 'memory_learning',
      performance_analyst: 'memory_learning', feedback: 'memory_learning',
      optimization: 'memory_learning', knowledge_distiller: 'memory_learning',
      regression: 'memory_learning', strategy_optimizer: 'memory_learning',
      security: 'control_safety', compliance: 'control_safety',
      input_validator: 'control_safety', output_validator: 'control_safety',
      access_controller: 'control_safety', error_handler: 'control_safety',
      consensus: 'control_safety', audit_logger: 'control_safety',
    };
    const lowerAgent = agentId.toLowerCase();
    for (const [prefix, cluster] of Object.entries(clusterPrefixes)) {
      if (lowerAgent.startsWith(prefix)) return cluster;
    }
    // Default: read-only if unknown
    return null;
  }
}

export { CLUSTER_PERMISSIONS, PROTECTED_PATTERNS };
