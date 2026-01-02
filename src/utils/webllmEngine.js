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

      // Create the engine with progress reporting
      engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (report) => {
          if (progressCallback) {
            progressCallback({
              progress: report.progress,
              text: report.text
            });
          }
        }
      });

      currentModel = modelId;

      if (progressCallback) {
        progressCallback({ progress: 1, text: 'Model loaded successfully!' });
      }
    } catch (error) {
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
