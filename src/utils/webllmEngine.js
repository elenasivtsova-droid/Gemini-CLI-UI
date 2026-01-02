/**
 * WebLLM Engine Service
 *
 * Provides a singleton engine for running LLMs locally in the browser using WebGPU.
 * This module handles model loading, caching, and chat completions.
 */

let engine = null;
let currentModel = null;
let isInitializing = false;
let initPromise = null;

// Progress callback for model loading
let progressCallback = null;

const FALLBACK_MODEL_BASE_URL = 'https://hf-mirror.com';

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

function ensureMlcOrg(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith('/mlc-ai') ? normalized : `${normalized}/mlc-ai`;
}

function rewriteModelUrl(url, baseUrl) {
  if (typeof url !== 'string') {
    return url;
  }
  const withOrg = ensureMlcOrg(baseUrl);
  return url.replace(/https?:\/\/[^/]+\/mlc-ai/, withOrg);
}

function buildAppConfigWithBaseUrl(webllm, baseUrl) {
  const appConfig = webllm.prebuiltAppConfig;
  if (!appConfig?.model_list || !Array.isArray(appConfig.model_list)) {
    return null;
  }
  return {
    ...appConfig,
    model_list: appConfig.model_list.map((model) => {
      if (!model) {
        return model;
      }
      const nextModel = { ...model };
      if (model.model) {
        nextModel.model = rewriteModelUrl(model.model, baseUrl);
      }
      if (model.model_url) {
        nextModel.model_url = rewriteModelUrl(model.model_url, baseUrl);
      }
      return nextModel;
    })
  };
}

/**
 * Set a callback to receive model loading progress updates
 * @param {function} callback - Function receiving { progress, text } updates
 */
export function setProgressCallback(callback) {
  progressCallback = callback;
}

/**
 * Check if WebGPU is supported in the current browser
 * @returns {Promise<boolean>}
 */
export async function isWebGPUSupported() {
  if (!navigator.gpu) {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Get the current engine status
 * @returns {{ isLoaded: boolean, currentModel: string|null, isInitializing: boolean }}
 */
export function getEngineStatus() {
  return {
    isLoaded: engine !== null,
    currentModel,
    isInitializing
  };
}

/**
 * Initialize or switch to a WebLLM model
 * @param {string} modelId - The model ID to load (e.g., 'Llama-3.1-8B-Instruct-q4f32_1-MLC')
 * @returns {Promise<void>}
 */
export async function initializeEngine(modelId) {
  // If already loading, wait for it
  if (isInitializing && initPromise) {
    await initPromise;
    // If the loaded model matches, we're done
    if (currentModel === modelId) {
      return;
    }
  }

  // If already loaded with the same model, skip
  if (engine && currentModel === modelId) {
    return;
  }

  isInitializing = true;

  initPromise = (async () => {
    try {
      // Dynamic import to avoid loading WebLLM until needed
      const webllm = await import('@mlc-ai/web-llm');

      // Report initial progress
      if (progressCallback) {
        progressCallback({ progress: 0, text: `Loading ${modelId}...` });
      }

      const availableModels = webllm.prebuiltAppConfig?.model_list?.map(m => m.model_id) || null;
      // Log available models for debugging
      console.log('[WebLLM] Available models:', availableModels || 'unknown');
      console.log('[WebLLM] Attempting to load:', modelId);

      if (Array.isArray(availableModels) && availableModels.length > 0 && !availableModels.includes(modelId)) {
        throw new Error(
          `WebLLM model "${modelId}" is not available. ` +
          `Pick one of: ${availableModels.join(', ')}`
        );
      }

      const createEngine = async (appConfigOverride = null) => {
        const options = {
          initProgressCallback: (report) => {
            console.log('[WebLLM] Progress:', report.text, Math.round(report.progress * 100) + '%');
            if (progressCallback) {
              progressCallback({
                progress: report.progress,
                text: report.text
              });
            }
          }
        };
        if (appConfigOverride) {
          options.appConfig = appConfigOverride;
        }
        return webllm.CreateMLCEngine(modelId, options);
      };

      try {
        // Create the engine with progress reporting
        engine = await createEngine();
      } catch (error) {
        const baseUrlCandidates = [];
        const envBaseUrl = import.meta.env?.VITE_WEBLLM_MODEL_BASE_URL?.trim();
        if (envBaseUrl) {
          baseUrlCandidates.push(envBaseUrl);
        }
        baseUrlCandidates.push(FALLBACK_MODEL_BASE_URL);

        let recovered = false;
        for (const baseUrl of baseUrlCandidates) {
          const appConfig = buildAppConfigWithBaseUrl(webllm, baseUrl);
          if (!appConfig) {
            continue;
          }
          console.warn('[WebLLM] Retrying with model base URL:', baseUrl);
          try {
            engine = await createEngine(appConfig);
            recovered = true;
            break;
          } catch (retryError) {
            error = retryError;
          }
        }

        if (!recovered) {
          throw error;
        }
      }

      currentModel = modelId;

      if (progressCallback) {
        progressCallback({ progress: 1, text: 'Model loaded successfully!' });
      }
    } catch (error) {
      console.error('[WebLLM] Initialization error:', error);
      console.error('[WebLLM] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      engine = null;
      currentModel = null;
      throw error;
    } finally {
      isInitializing = false;
      initPromise = null;
    }
  })();

  await initPromise;
}

/**
 * Unload the current model and free resources
 */
export async function unloadEngine() {
  if (engine) {
    try {
      await engine.unload();
    } catch (e) {
      // Ignore unload errors
    }
    engine = null;
    currentModel = null;
  }
}

/**
 * Generate a chat completion with streaming
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {object} options - Generation options
 * @param {function} onChunk - Callback for each generated chunk
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<string>} - Complete response
 */
export async function generateChatCompletion(messages, options = {}, onChunk = null, signal = null) {
  if (!engine) {
    throw new Error('WebLLM engine not initialized. Call initializeEngine first.');
  }

  let fullResponse = '';
  let aborted = false;

  // Handle abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
  }

  try {
    const completion = await engine.chat.completions.create({
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
      ...options
    });

    for await (const chunk of completion) {
      if (aborted) {
        break;
      }

      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        if (onChunk) {
          onChunk(content, fullResponse);
        }
      }
    }

    return fullResponse;
  } catch (error) {
    if (aborted) {
      return fullResponse; // Return partial response on abort
    }
    throw error;
  }
}

/**
 * Get statistics about the last generation
 * @returns {Promise<object>}
 */
export async function getStats() {
  if (!engine) {
    return null;
  }
  try {
    return await engine.runtimeStatsText();
  } catch {
    return null;
  }
}

/**
 * Reset the chat state (clear conversation history in the engine)
 */
export async function resetChat() {
  if (engine) {
    try {
      await engine.resetChat();
    } catch {
      // Ignore reset errors
    }
  }
}

export default {
  isWebGPUSupported,
  getEngineStatus,
  initializeEngine,
  unloadEngine,
  generateChatCompletion,
  getStats,
  resetChat,
  setProgressCallback
};
