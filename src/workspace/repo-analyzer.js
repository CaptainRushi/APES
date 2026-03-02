/**
 * RepoAnalyzer — Project repository analysis
 *
 * Scans project directory to determine:
 *   - Languages used (by extension)
 *   - Frameworks detected (by config file presence)
 *   - Directory structure summary
 *   - Project statistics (file count, LOC)
 *   - Package info (package.json, etc.)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, relative, resolve } from 'node:path';

const EXTENSION_MAP = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.pyw': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.c': 'C', '.h': 'C',
  '.swift': 'Swift',
  '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.scala': 'Scala',
  '.r': 'R', '.R': 'R',
  '.lua': 'Lua',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.css': 'CSS', '.scss': 'SCSS', '.less': 'Less', '.sass': 'Sass',
  '.html': 'HTML', '.htm': 'HTML',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.sql': 'SQL',
  '.md': 'Markdown', '.mdx': 'Markdown',
  '.graphql': 'GraphQL', '.gql': 'GraphQL',
  '.proto': 'Protobuf',
  '.dockerfile': 'Dockerfile',
};

const FRAMEWORK_DETECTORS = [
  { file: 'package.json', name: 'Node.js', type: 'runtime',
    deep: (content) => {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const found = [];
        if (deps.react || deps['react-dom']) found.push({ name: 'React', version: deps.react || deps['react-dom'] });
        if (deps.next) found.push({ name: 'Next.js', version: deps.next });
        if (deps.vue) found.push({ name: 'Vue', version: deps.vue });
        if (deps.nuxt) found.push({ name: 'Nuxt', version: deps.nuxt });
        if (deps.angular || deps['@angular/core']) found.push({ name: 'Angular', version: deps['@angular/core'] });
        if (deps.svelte) found.push({ name: 'Svelte', version: deps.svelte });
        if (deps.express) found.push({ name: 'Express', version: deps.express });
        if (deps.fastify) found.push({ name: 'Fastify', version: deps.fastify });
        if (deps.nestjs || deps['@nestjs/core']) found.push({ name: 'NestJS', version: deps['@nestjs/core'] });
        if (deps.electron) found.push({ name: 'Electron', version: deps.electron });
        if (deps.jest) found.push({ name: 'Jest', version: deps.jest });
        if (deps.vitest) found.push({ name: 'Vitest', version: deps.vitest });
        if (deps.mocha) found.push({ name: 'Mocha', version: deps.mocha });
        if (deps.webpack) found.push({ name: 'Webpack', version: deps.webpack });
        if (deps.vite) found.push({ name: 'Vite', version: deps.vite });
        if (deps.esbuild) found.push({ name: 'esbuild', version: deps.esbuild });
        if (deps.tailwindcss) found.push({ name: 'Tailwind CSS', version: deps.tailwindcss });
        if (deps.prisma || deps['@prisma/client']) found.push({ name: 'Prisma', version: deps.prisma || deps['@prisma/client'] });
        if (deps.mongoose) found.push({ name: 'Mongoose', version: deps.mongoose });
        if (deps.sequelize) found.push({ name: 'Sequelize', version: deps.sequelize });
        return found;
      } catch { return []; }
    }
  },
  { file: 'tsconfig.json', name: 'TypeScript', type: 'language' },
  { file: 'Dockerfile', name: 'Docker', type: 'infra' },
  { file: 'docker-compose.yml', name: 'Docker Compose', type: 'infra' },
  { file: 'docker-compose.yaml', name: 'Docker Compose', type: 'infra' },
  { file: '.github/workflows', name: 'GitHub Actions', type: 'ci', isDir: true },
  { file: '.gitlab-ci.yml', name: 'GitLab CI', type: 'ci' },
  { file: 'Jenkinsfile', name: 'Jenkins', type: 'ci' },
  { file: 'requirements.txt', name: 'Python (pip)', type: 'runtime' },
  { file: 'pyproject.toml', name: 'Python (pyproject)', type: 'runtime' },
  { file: 'setup.py', name: 'Python (setuptools)', type: 'runtime' },
  { file: 'Pipfile', name: 'Pipenv', type: 'runtime' },
  { file: 'Cargo.toml', name: 'Rust (Cargo)', type: 'runtime' },
  { file: 'go.mod', name: 'Go Modules', type: 'runtime' },
  { file: 'Gemfile', name: 'Ruby (Bundler)', type: 'runtime' },
  { file: 'pom.xml', name: 'Maven', type: 'build' },
  { file: 'build.gradle', name: 'Gradle', type: 'build' },
  { file: 'build.gradle.kts', name: 'Gradle (Kotlin)', type: 'build' },
  { file: '.eslintrc.js', name: 'ESLint', type: 'quality' },
  { file: '.eslintrc.json', name: 'ESLint', type: 'quality' },
  { file: 'eslint.config.js', name: 'ESLint (flat)', type: 'quality' },
  { file: '.prettierrc', name: 'Prettier', type: 'quality' },
  { file: 'prettier.config.js', name: 'Prettier', type: 'quality' },
  { file: 'jest.config.js', name: 'Jest', type: 'test' },
  { file: 'jest.config.ts', name: 'Jest', type: 'test' },
  { file: 'vitest.config.js', name: 'Vitest', type: 'test' },
  { file: 'vitest.config.ts', name: 'Vitest', type: 'test' },
  { file: 'terraform', name: 'Terraform', type: 'infra', isDir: true },
  { file: 'k8s', name: 'Kubernetes', type: 'infra', isDir: true },
  { file: 'kubernetes', name: 'Kubernetes', type: 'infra', isDir: true },
];

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', '.cache', '.next', '.nuxt', '.output', 'vendor', 'target'];

export class RepoAnalyzer {
  constructor(projectRoot) {
    this.projectRoot = resolve(projectRoot);
  }

  analyze() {
    return {
      languages: this.detectLanguages(),
      frameworks: this.detectFrameworks(),
      structure: this.getStructure(),
      stats: this.getStats(),
      packageInfo: this.getPackageInfo(),
    };
  }

  detectLanguages() {
    const counts = {};
    this._walkForLangs(this.projectRoot, 0, 10, counts);

    const total = Object.values(counts).reduce((s, c) => s + c.files, 0) || 1;
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1].files - a[1].files)
      .map(([lang, data]) => ({
        language: lang,
        files: data.files,
        percentage: Math.round((data.files / total) * 100),
        extensions: [...data.extensions],
      }));

    return sorted;
  }

  detectFrameworks() {
    const detected = [];
    const seen = new Set();

    for (const detector of FRAMEWORK_DETECTORS) {
      const fullPath = join(this.projectRoot, detector.file);
      const exists = detector.isDir
        ? existsSync(fullPath) && statSync(fullPath).isDirectory()
        : existsSync(fullPath);

      if (!exists) continue;
      if (seen.has(detector.name)) continue;
      seen.add(detector.name);

      const entry = { name: detector.name, type: detector.type, configFile: detector.file };

      // Deep inspection
      if (detector.deep && !detector.isDir) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const extras = detector.deep(content);
          if (extras.length > 0) {
            for (const extra of extras) {
              if (!seen.has(extra.name)) {
                seen.add(extra.name);
                detected.push({ ...extra, type: 'framework', configFile: detector.file });
              }
            }
          }
        } catch { /* skip */ }
      }

      detected.push(entry);
    }

    return detected;
  }

  getStructure(maxDepth = 3) {
    const tree = this._buildTree(this.projectRoot, 0, maxDepth);
    let totalFiles = 0, totalDirs = 0;
    this._countNodes(tree, (isDir) => { if (isDir) totalDirs++; else totalFiles++; });
    return { tree, totalFiles, totalDirs };
  }

  getStats() {
    const stats = { totalFiles: 0, totalDirs: 0, totalLOC: 0, totalSize: 0, largestFiles: [] };
    this._walkForStats(this.projectRoot, 0, 10, stats);

    stats.avgFileSize = stats.totalFiles > 0 ? Math.round(stats.totalSize / stats.totalFiles) : 0;
    stats.largestFiles = stats.largestFiles
      .sort((a, b) => b.size - a.size)
      .slice(0, 5);

    return stats;
  }

  getPackageInfo() {
    const pkgPath = join(this.projectRoot, 'package.json');
    if (!existsSync(pkgPath)) return null;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return {
        name: pkg.name || null,
        version: pkg.version || null,
        description: pkg.description || null,
        type: pkg.type || 'commonjs',
        scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
        dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).length : 0,
        devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0,
      };
    } catch {
      return null;
    }
  }

  _walkForLangs(dirPath, depth, maxDepth, counts) {
    if (depth > maxDepth) return;
    try {
      const items = readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (EXCLUDED_DIRS.includes(item.name)) continue;
        const full = join(dirPath, item.name);
        if (item.isDirectory()) {
          this._walkForLangs(full, depth + 1, maxDepth, counts);
        } else if (item.isFile()) {
          const ext = extname(item.name).toLowerCase();
          // Special case for Dockerfile
          const lang = item.name === 'Dockerfile' ? 'Dockerfile' : EXTENSION_MAP[ext];
          if (lang) {
            if (!counts[lang]) counts[lang] = { files: 0, extensions: new Set() };
            counts[lang].files++;
            counts[lang].extensions.add(ext || item.name);
          }
        }
      }
    } catch { /* permission denied */ }
  }

  _walkForStats(dirPath, depth, maxDepth, stats) {
    if (depth > maxDepth) return;
    try {
      const items = readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (EXCLUDED_DIRS.includes(item.name)) continue;
        const full = join(dirPath, item.name);
        if (item.isDirectory()) {
          stats.totalDirs++;
          this._walkForStats(full, depth + 1, maxDepth, stats);
        } else if (item.isFile()) {
          stats.totalFiles++;
          try {
            const s = statSync(full);
            stats.totalSize += s.size;
            stats.largestFiles.push({
              path: relative(this.projectRoot, full).replace(/\\/g, '/'),
              size: s.size,
            });
            // Count LOC for text files under 1MB
            if (s.size < 1048576) {
              const ext = extname(item.name).toLowerCase();
              if (EXTENSION_MAP[ext]) {
                const content = readFileSync(full, 'utf-8');
                stats.totalLOC += content.split('\n').length;
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* permission denied */ }
  }

  _buildTree(dirPath, depth, maxDepth) {
    const name = basename(dirPath);
    const node = { name, type: 'directory', children: [] };
    if (depth >= maxDepth) return node;
    try {
      const items = readdirSync(dirPath, { withFileTypes: true })
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });
      for (const item of items) {
        if (EXCLUDED_DIRS.includes(item.name)) continue;
        const full = join(dirPath, item.name);
        if (item.isDirectory()) {
          node.children.push(this._buildTree(full, depth + 1, maxDepth));
        } else {
          node.children.push({ name: item.name, type: 'file', extension: extname(item.name) });
        }
      }
    } catch { /* permission denied */ }
    return node;
  }

  _countNodes(node, callback) {
    if (!node) return;
    callback(node.type === 'directory');
    if (node.children) {
      for (const child of node.children) {
        this._countNodes(child, callback);
      }
    }
  }
}
