import os from 'os';
import path from 'path';

const rawProvider = (process.env.CLI_PROVIDER || 'gemini').toLowerCase();
const provider = rawProvider === 'codex' ? 'codex'
  : rawProvider === 'webllm' ? 'webllm'
  : rawProvider === 'claude' ? 'claude'
  : 'gemini';

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const claudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
const geminiHome = path.join(os.homedir(), '.gemini');
const uiHome = process.env.CLI_UI_HOME || (provider === 'codex'
  ? path.join(codexHome, 'cli-ui')
  : provider === 'claude'
  ? path.join(claudeHome, 'cli-ui')
  : geminiHome);

const cliModelCatalog = {
  gemini: [
    { value: 'gemini-3-pro-preview', label: 'Gemini 3.0 Pro', description: 'Next generation reasoning and capabilities' },
    { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash', description: 'Ultra-fast next gen model' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient latest model (Recommended)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most advanced model (Note: May have quota limits)' },
    { value: 'gemini-2.0-flash-thinking-exp-01-21', label: 'Gemini 2.0 Flash Thinking', description: 'Thinking model with extended reasoning capabilities' },
    { value: 'gemini-2.0-pro-exp-02-05', label: 'Gemini 2.0 Pro', description: 'Advanced experimental model' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Balanced performance and capabilities' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Fast and cost-effective' }
  ],
  codex: [
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', description: 'Largest Codex reasoning profile and tool depth' },
    { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', description: 'Balanced Codex model for coding tasks' },
    { value: 'gpt-5.1', label: 'GPT-5.1', description: 'General-purpose GPT-5.1 for mixed workloads' },
    { value: 'gpt-5.2', label: 'GPT-5.2', description: 'Latest general model with strong reasoning' },
    { value: 'o3', label: 'o3', description: 'Reasoning-focused model' },
    { value: 'o4-mini', label: 'o4-mini', description: 'Fast, lightweight reasoning model' }
  ],
  claude: [
    { value: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', description: 'Strong reasoning and coding with balanced speed' },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', description: 'High-quality output with reliable coding performance' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', description: 'Fast, lightweight model for quick iterations' }
  ],
  webllm: [
    { value: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', label: 'Llama 3.2 1B', description: 'Smallest model, fastest loading (Recommended to test)' },
    { value: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', label: 'Llama 3.2 3B', description: 'Lightweight model, good balance' },
    { value: 'Llama-3.1-8B-Instruct-q4f32_1-MLC', label: 'Llama 3.1 8B', description: 'Larger model, better quality' },
    { value: 'Phi-3.5-mini-instruct-q4f32_1-MLC', label: 'Phi 3.5 Mini', description: 'Microsoft Phi model, efficient' },
    { value: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B', description: 'Google Gemma, small and fast' },
    { value: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen 3 0.6B', description: 'Tiny model for quick testing' }
  ]
};

const defaultModelByProvider = {
  gemini: 'gemini-2.5-flash',
  codex: 'gpt-5.1-codex-max',
  claude: 'claude-3-5-sonnet-latest',
  webllm: 'Llama-3.2-1B-Instruct-q4f32_1-MLC'
};

function getCliProvider() {
  return provider;
}

function normalizeProvider(providerOverride) {
  if (!providerOverride) return provider;
  const p = providerOverride.toLowerCase();
  if (p === 'codex') return 'codex';
  if (p === 'claude') return 'claude';
  if (p === 'webllm') return 'webllm';
  return 'gemini';
}

function getCliCommand(providerOverride) {
  const resolvedProvider = normalizeProvider(providerOverride);
  if (resolvedProvider === 'codex') {
    return process.env.CODEX_PATH || 'codex';
  }
  if (resolvedProvider === 'claude') {
    return process.env.CLAUDE_PATH || 'claude';
  }
  return process.env.GEMINI_PATH || 'gemini';
}

function getUiHome(providerOverride) {
  const resolvedProvider = normalizeProvider(providerOverride);
  if (process.env.CLI_UI_HOME) {
    return process.env.CLI_UI_HOME;
  }
  if (resolvedProvider === 'codex') {
    return path.join(codexHome, 'cli-ui');
  }
  if (resolvedProvider === 'claude') {
    return path.join(claudeHome, 'cli-ui');
  }
  return geminiHome;
}

function getProjectsRoot(providerOverride) {
  return path.join(getUiHome(providerOverride), 'projects');
}

function getSessionsRoot(providerOverride) {
  return path.join(getUiHome(providerOverride), 'sessions');
}

function getProjectConfigPath(providerOverride) {
  return path.join(getUiHome(providerOverride), 'project-config.json');
}

function getCliInfo(providerOverride) {
  const resolvedProvider = normalizeProvider(providerOverride);
  const models = cliModelCatalog[resolvedProvider] || cliModelCatalog.gemini;
  const displayNames = {
    gemini: 'Gemini CLI',
    codex: 'Codex CLI',
    claude: 'Claude CLI',
    webllm: 'WebLLM (Local)'
  };
  return {
    provider: resolvedProvider,
    displayName: displayNames[resolvedProvider] || 'Gemini CLI',
    defaultModel: defaultModelByProvider[resolvedProvider] || defaultModelByProvider.gemini,
    models
  };
}

function getCliSetup(providerOverride) {
  const resolvedProvider = normalizeProvider(providerOverride);
  const docs = {
    gemini: 'https://github.com/google-gemini/gemini-cli',
    codex: 'https://github.com/openai/codex',
    claude: 'https://docs.anthropic.com/en/docs/claude-code/cli',
    webllm: 'https://webllm.mlc.ai/'
  };

  const installCommandEnv = {
    gemini: process.env.GEMINI_INSTALL_CMD,
    codex: process.env.CODEX_INSTALL_CMD,
    claude: process.env.CLAUDE_INSTALL_CMD,
    webllm: ''
  };
  const loginCommandEnv = {
    gemini: process.env.GEMINI_LOGIN_CMD,
    codex: process.env.CODEX_LOGIN_CMD,
    claude: process.env.CLAUDE_LOGIN_CMD,
    webllm: ''
  };

  return {
    docsUrl: docs[resolvedProvider] || docs.gemini,
    installCommand: installCommandEnv[resolvedProvider] || '',
    loginCommand: loginCommandEnv[resolvedProvider] || ''
  };
}

function buildSpawnEnv(baseEnv = process.env) {
  const extraPaths = [
    baseEnv.NVM_BIN,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ].filter(Boolean);
  const currentPath = baseEnv.PATH || '';
  const parts = currentPath.split(path.delimiter).filter(Boolean);
  const combined = [...extraPaths, ...parts];
  const seen = new Set();
  const deduped = combined.filter(entry => {
    if (seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });

  return {
    ...baseEnv,
    PATH: deduped.join(path.delimiter)
  };
}

export {
  getCliProvider,
  normalizeProvider,
  getCliCommand,
  getUiHome,
  getProjectsRoot,
  getSessionsRoot,
  getProjectConfigPath,
  getCliInfo,
  getCliSetup,
  buildSpawnEnv
};
