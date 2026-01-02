import os from 'os';
import path from 'path';

const rawProvider = (process.env.CLI_PROVIDER || 'gemini').toLowerCase();
const provider = rawProvider === 'codex' ? 'codex' : rawProvider === 'webllm' ? 'webllm' : 'gemini';

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const geminiHome = path.join(os.homedir(), '.gemini');
const uiHome = process.env.CLI_UI_HOME || (provider === 'codex' ? path.join(codexHome, 'cli-ui') : geminiHome);

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
  webllm: [
    { value: 'Llama-3.1-8B-Instruct-q4f32_1-MLC', label: 'Llama 3.1 8B', description: 'Fast local model, good for general tasks (Recommended)' },
    { value: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', label: 'Llama 3.2 3B', description: 'Lightweight model, faster loading' },
    { value: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 Mini', description: 'Microsoft Phi model, efficient and capable' },
    { value: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', label: 'Mistral 7B', description: 'Balanced performance and quality' },
    { value: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 7B', description: 'Strong multilingual support' },
    { value: 'gemma-2-9b-it-q4f16_1-MLC', label: 'Gemma 2 9B', description: 'Google Gemma model, high quality' }
  ]
};

const defaultModelByProvider = {
  gemini: 'gemini-2.5-flash',
  codex: 'gpt-5.1-codex-max',
  webllm: 'Llama-3.1-8B-Instruct-q4f32_1-MLC'
};

function getCliProvider() {
  return provider;
}

function normalizeProvider(providerOverride) {
  if (!providerOverride) return provider;
  const p = providerOverride.toLowerCase();
  if (p === 'codex') return 'codex';
  if (p === 'webllm') return 'webllm';
  return 'gemini';
}

function getCliCommand(providerOverride) {
  const resolvedProvider = normalizeProvider(providerOverride);
  return resolvedProvider === 'codex' ? (process.env.CODEX_PATH || 'codex') : (process.env.GEMINI_PATH || 'gemini');
}

function getUiHome(providerOverride) {
  const resolvedProvider = normalizeProvider(providerOverride);
  if (process.env.CLI_UI_HOME) {
    return process.env.CLI_UI_HOME;
  }
  return resolvedProvider === 'codex' ? path.join(codexHome, 'cli-ui') : geminiHome;
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
    webllm: 'WebLLM (Local)'
  };
  return {
    provider: resolvedProvider,
    displayName: displayNames[resolvedProvider] || 'Gemini CLI',
    defaultModel: defaultModelByProvider[resolvedProvider] || defaultModelByProvider.gemini,
    models
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
  getCliInfo
};
