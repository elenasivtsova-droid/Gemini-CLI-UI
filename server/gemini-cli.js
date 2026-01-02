import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import sessionManager from './sessionManager.js';
import GeminiResponseHandler from './gemini-response-handler.js';
import { buildSpawnEnv, getCliCommand, getCliInfo, normalizeProvider } from './cli-config.js';

let activeGeminiProcesses = new Map(); // Track active processes by session ID

function splitCommandArgs(input) {
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function sanitizeCliOutput(output) {
  if (!output) return '';
  // Strip ANSI escape sequences and control chars while preserving newlines.
  const withoutAnsi = output
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '');
  return withoutAnsi.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function stripOllamaSpinner(output) {
  if (!output) return '';
  // Ollama uses braille spinner glyphs; strip them to avoid noise messages.
  return output.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '');
}

async function spawnGemini(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, toolsSettings, permissionMode, images } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let fullResponse = ''; // Accumulate the full response
    const cliProvider = normalizeProvider(options.provider);
    const providerLabel = cliProvider === 'codex' ? 'Codex' : cliProvider === 'claude' ? 'Claude' : cliProvider === 'ollama' ? 'Ollama' : cliProvider === 'bmad' ? 'BMAD' : 'Gemini';
    let pendingExternalSessionId = null;
    
    // Process images if provided
    
    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };
    
    // Use tools settings
    
    // Build CLI command
    const args = [];
    let promptToUse = '';
    
    // Construct prompt if we have a command
    if (command && command.trim()) {
      if (sessionId) {
        if (cliProvider === 'bmad') {
          promptToUse = command;
        } else {
          const externalSessionId = cliProvider === 'codex' ? sessionManager.getExternalSessionId(sessionId) : null;
          if (!externalSessionId) {
            const context = sessionManager.buildConversationContext(sessionId);
            if (context) {
              promptToUse = context + command;
            } else {
              promptToUse = command;
            }
          } else {
            promptToUse = command;
          }
        }
      } else {
        promptToUse = command;
      }
    }
    
    // Use cwd (actual project directory) instead of projectPath (Gemini's metadata directory)
    // Debug - cwd and projectPath
    // Clean the path by removing any non-printable characters
    const cleanPath = (cwd || process.cwd()).replace(/[^\x20-\x7E]/g, '').trim();
    let workingDir = cleanPath;
    try {
      await fs.access(workingDir);
    } catch {
      workingDir = process.env.HOME || process.cwd();
    }
    // Debug - workingDir
    
    // Handle images by saving them to temporary files and passing paths to CLI
    const tempImagePaths = [];
    let tempDir = null;
    if (images && images.length > 0 && cliProvider !== 'bmad') {
      try {
        // Create temp directory in the project directory so Gemini can access it
        // Use a non-hidden directory to avoid potential issues with CLI file access
        const tempDirName = cliProvider === 'codex'
          ? 'codex_tmp_images'
          : cliProvider === 'claude'
          ? 'claude_tmp_images'
          : cliProvider === 'ollama'
          ? 'ollama_tmp_images'
          : cliProvider === 'bmad'
          ? 'bmad_tmp_images'
          : 'gemini_tmp_images';
        tempDir = path.join(workingDir, tempDirName, Date.now().toString());
        await fs.mkdir(tempDir, { recursive: true });
        
        // Save each image to a temp file
        for (const [index, image] of images.entries()) {
          // Extract base64 data and mime type
          const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            // console.error('Invalid image data format');
            continue;
          }
          
          const [, mimeType, base64Data] = matches;
          const extension = mimeType.split('/')[1] || 'png';
          const filename = `image_${index}.${extension}`;
          const filepath = path.join(tempDir, filename);
          
          // Write base64 data to file
          await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
          tempImagePaths.push(filepath);
        }
        
        if (cliProvider !== 'codex') {
          // Include the full image paths in the prompt for Gemini to reference
          // Use relative paths to ensure compatibility
          if (tempImagePaths.length > 0 && promptToUse) {
            const imageNote = `\n\n[画像を添付しました: ${tempImagePaths.length}枚の画像があります。以下のパスに保存されています:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${path.relative(workingDir, p)}`).join('\n')}`;
            promptToUse += imageNote;
          }
        }
        
        
      } catch (error) {
        // console.error('Error processing images for Gemini:', error);
      }
    }
    
    // Gemini doesn't support resume functionality
    // Skip resume handling
    
    if (cliProvider === 'codex') {
      args.push('exec', '--skip-git-repo-check', '--json');
      const modelToUse = options.model || getCliInfo(cliProvider).defaultModel;
      if (modelToUse) {
        args.push('--model', modelToUse);
      }
      if (settings.skipPermissions) {
        args.push('--full-auto', '--sandbox', 'danger-full-access');
      } else {
        args.push('--sandbox', 'read-only');
      }
      if (tempImagePaths.length > 0) {
        args.push('--image', tempImagePaths.join(','));
      }
      const externalSessionId = sessionId ? sessionManager.getExternalSessionId(sessionId) : null;
      if (externalSessionId) {
        args.push('resume', externalSessionId);
      }
    } else if (cliProvider === 'claude') {
      const modelToUse = options.model || getCliInfo(cliProvider).defaultModel;
      if (modelToUse) {
        args.push('--model', modelToUse);
      }
    } else if (cliProvider === 'ollama') {
      const modelToUse = options.model || getCliInfo(cliProvider).defaultModel;
      args.push('run', modelToUse);
    } else if (cliProvider === 'bmad') {
      // BMAD CLI commands do not use model selection or Gemini-specific flags.
    } else {
      // Add basic flags for Gemini
      if (options.debug) {
        args.push('--debug');
      }
      
      // Add MCP config flag only if MCP servers are configured
      try {
        // Use already imported modules (fs.promises is imported as fs, path, os)
        const fsSync = await import('fs'); // Import synchronous fs methods
        
        // Check for MCP config in ~/.gemini.json
        const geminiConfigPath = path.join(os.homedir(), '.gemini.json');
        
        
        let hasMcpServers = false;
        
        // Check Gemini config for MCP servers
        if (fsSync.existsSync(geminiConfigPath)) {
          try {
            const geminiConfig = JSON.parse(fsSync.readFileSync(geminiConfigPath, 'utf8'));
            
            // Check global MCP servers
            if (geminiConfig.mcpServers && Object.keys(geminiConfig.mcpServers).length > 0) {
              hasMcpServers = true;
            }
            
            // Check project-specific MCP servers
            if (!hasMcpServers && geminiConfig.geminiProjects) {
              const currentProjectPath = process.cwd();
              const projectConfig = geminiConfig.geminiProjects[currentProjectPath];
              if (projectConfig && projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0) {
                hasMcpServers = true;
              }
            }
          } catch (e) {
          }
        }
        
        
        if (hasMcpServers) {
          // Use Gemini config file if it has MCP servers
          let configPath = null;
          
          if (fsSync.existsSync(geminiConfigPath)) {
            try {
              const geminiConfig = JSON.parse(fsSync.readFileSync(geminiConfigPath, 'utf8'));
              
              // Check if we have any MCP servers (global or project-specific)
              const hasGlobalServers = geminiConfig.mcpServers && Object.keys(geminiConfig.mcpServers).length > 0;
              const currentProjectPath = process.cwd();
              const projectConfig = geminiConfig.geminiProjects && geminiConfig.geminiProjects[currentProjectPath];
              const hasProjectServers = projectConfig && projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0;
              
              if (hasGlobalServers || hasProjectServers) {
                configPath = geminiConfigPath;
              }
            } catch (e) {
              // No valid config found
            }
          }
          
          if (configPath) {
            args.push('--mcp-config', configPath);
          } else {
          }
        }
      } catch (error) {
        // If there's any error checking for MCP configs, don't add the flag
        // MCP config check failed, proceeding without MCP support
      }
      
      // Add model for all sessions (both new and resumed)
      const modelToUse = options.model || 'gemini-2.5-flash';
      args.push('--model', modelToUse);
      
      // Add --yolo flag if skipPermissions is enabled
      if (settings.skipPermissions) {
        args.push('--yolo');
      } else {
        // Pass allowed tools to Gemini CLI
        // Ensure critical tools are always available by adding them to the allowed list
        const criticalTools = [
          'run_shell_command', 
          'Bash', 
          'Bash(git log:*)', 
          'Bash(git diff:*)', 
          'Bash(git status:*)',
          'write_file',
          'read_file',
          'search_file_content',
          'save_memory',
          'replace',
          'Write',
          'Read',
          'Edit',
          'Glob',
          'Grep'
        ];
        
        let toolsToAllow = [...(settings.allowedTools || [])];
        
        // Add critical tools if not already present
        criticalTools.forEach(tool => {
          if (!toolsToAllow.includes(tool)) {
            toolsToAllow.push(tool);
          }
        });
        
        if (toolsToAllow.length > 0) {
          args.push('--allowed-tools', ...toolsToAllow);
        }
      }
    }
    
    // console.log('Spawning Gemini CLI with args:', args);
    // console.log('Working directory:', workingDir);
    
    // Add prompt as a positional argument at the end
    if (promptToUse) {
      if (cliProvider === 'bmad') {
        args.push(...splitCommandArgs(promptToUse));
      } else {
        args.push(promptToUse);
      }
    }

    // Try to find gemini in PATH first, then fall back to environment variable
    const geminiPath = getCliCommand(cliProvider);
    // console.log('Full command:', geminiPath, args.join(' '));
    
    const spawnEnv = buildSpawnEnv(process.env);
    if (process.env.CLI_DEBUG_PATHS === '1') {
      // Useful for diagnosing spawn ENOENT issues without always spamming logs.
      // eslint-disable-next-line no-console
      console.log('[cli-spawn] PATH=', spawnEnv.PATH);
    }
    const geminiProcess = spawn(geminiPath, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv // Inherit all environment variables plus a safe PATH
    });
    
    // Attach temp file info to process for cleanup later
    geminiProcess.tempImagePaths = tempImagePaths;
    geminiProcess.tempDir = tempDir;
    
    // Store process reference for potential abort
    const processKey = capturedSessionId || sessionId || Date.now().toString();
    activeGeminiProcesses.set(processKey, geminiProcess);
    // Debug - Stored Gemini process with key
    
    // Store sessionId on the process object for debugging
    geminiProcess.sessionId = processKey;
    
    // Close stdin to signal we're done sending input
    geminiProcess.stdin.end();
    
    // Add timeout handler
    let hasReceivedOutput = false;
    const timeoutMs = cliProvider === 'codex' ? 120000 : cliProvider === 'ollama' ? 120000 : cliProvider === 'bmad' ? 120000 : 30000; // 120s for Codex/Ollama/BMAD
    const timeout = setTimeout(() => {
      if (!hasReceivedOutput) {
        // console.error('⏰ Gemini CLI timeout - no output received after', timeoutMs, 'ms');
        ws.send(JSON.stringify({
          type: 'gemini-error',
          error: `${providerLabel} CLI timeout - no response received`
        }));
        geminiProcess.kill('SIGTERM');
      }
    }, timeoutMs);
    
    // Save user message to session when starting
    if (command && capturedSessionId) {
      sessionManager.addMessage(capturedSessionId, 'user', command);
    }
    
    // Create response handler for intelligent buffering
    let responseHandler;
    if (ws && cliProvider !== 'ollama') {
      responseHandler = new GeminiResponseHandler(ws, {
        partialDelay: 300,
        maxWaitTime: 1500,
        minBufferSize: 30
      });
    }
    
    // Handle stdout (Gemini outputs plain text)
    let outputBuffer = '';
    let codexLineBuffer = '';
    let codexStderrBuffer = '';
    
    geminiProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      outputBuffer += rawOutput;
      hasReceivedOutput = true;
      clearTimeout(timeout);
      
      if (cliProvider === 'codex') {
        codexLineBuffer += rawOutput;
        const lines = codexLineBuffer.split('\n');
        codexLineBuffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          let event;
          try {
            event = JSON.parse(trimmed);
          } catch (e) {
            continue;
          }
          
          if (event.type === 'thread.started' && event.thread_id) {
            pendingExternalSessionId = event.thread_id;
            if (capturedSessionId) {
              sessionManager.setExternalSessionId(capturedSessionId, event.thread_id);
            }
          }
          
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            const content = event.item.text || '';
            if (content) {
              fullResponse += (fullResponse ? '\n' : '') + content;
              if (responseHandler) {
                responseHandler.processData(content);
              } else {
                ws.send(JSON.stringify({
                  type: 'gemini-response',
                  data: {
                    type: 'message',
                    content: content
                  }
                }));
              }
            }
          }
          
          if (event.type === 'turn.failed' || event.type === 'error') {
            ws.send(JSON.stringify({
              type: 'gemini-error',
              error: event.error?.message || event.message || 'Codex CLI error'
            }));
          }
        }
      } else if (cliProvider === 'gemini') {
        // Filter out debug messages and system messages
        const lines = rawOutput.split('\n');
        const filteredLines = lines.filter(line => {
          // Skip debug messages and "Loaded cached credentials"
          if (line.includes('[DEBUG]') || 
              line.includes('Flushing log events') || 
              line.includes('Clearcut response') ||
              line.includes('[MemoryDiscovery]') ||
              line.includes('[BfsFileSearch]') ||
              line.includes('Loaded cached credentials')) {
            return false;
          }
          return true;
        });
        
        const filteredOutput = filteredLines.join('\n').trim();
        
        if (filteredOutput) {
          fullResponse += (fullResponse ? '\n' : '') + filteredOutput;
          
          if (responseHandler) {
            responseHandler.processData(filteredOutput);
          } else {
            ws.send(JSON.stringify({
              type: 'gemini-response',
              data: {
                type: 'message',
                content: filteredOutput
              }
            }));
          }
        }
      } else if (cliProvider === 'ollama') {
        const sanitizedOutput = stripOllamaSpinner(sanitizeCliOutput(rawOutput));
        if (sanitizedOutput.trim()) {
          fullResponse += sanitizedOutput;
        }
      } else {
        const trimmedOutput = rawOutput.trim();
        if (trimmedOutput) {
          fullResponse += (fullResponse ? '\n' : '') + trimmedOutput;
          
          if (responseHandler) {
            responseHandler.processData(trimmedOutput);
          } else {
            ws.send(JSON.stringify({
              type: 'gemini-response',
              data: {
                type: 'message',
                content: trimmedOutput
              }
            }));
          }
        }
      }
      
      // For new sessions, create a session ID
      if (!sessionId && !sessionCreatedSent && !capturedSessionId) {
        const sessionPrefix = cliProvider === 'codex' ? 'codex' : cliProvider === 'claude' ? 'claude' : cliProvider === 'ollama' ? 'ollama' : cliProvider === 'bmad' ? 'bmad' : 'gemini';
        capturedSessionId = `${sessionPrefix}_${Date.now()}`;
        sessionCreatedSent = true;
        
        // Create session in session manager
        sessionManager.createSession(capturedSessionId, cwd || process.cwd(), cliProvider);
        
        // Save the user message now that we have a session ID
        if (command) {
          sessionManager.addMessage(capturedSessionId, 'user', command);
        }
        
        if (pendingExternalSessionId) {
          sessionManager.setExternalSessionId(capturedSessionId, pendingExternalSessionId);
        }
        
        // Update process key with captured session ID
        if (processKey !== capturedSessionId) {
          activeGeminiProcesses.delete(processKey);
          activeGeminiProcesses.set(capturedSessionId, geminiProcess);
        }
        
        ws.send(JSON.stringify({
          type: 'session-created',
          sessionId: capturedSessionId
        }));
      }
    });
    
    // Handle stderr
    geminiProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      // Debug - Raw Gemini stderr
      
      // Filter out deprecation warnings and "Loaded cached credentials" message
      if (errorMsg.includes('[DEP0040]') || 
          errorMsg.includes('DeprecationWarning') ||
          errorMsg.includes('--trace-deprecation') ||
          errorMsg.includes('Loaded cached credentials')) {
        // Log but don't send to client
        // Debug - Gemini CLI warning (suppressed)
        return;
      }
      if (cliProvider === 'codex') {
        codexStderrBuffer += errorMsg;
        return;
      }
      
      if (cliProvider === 'ollama') {
        const sanitizedError = stripOllamaSpinner(sanitizeCliOutput(errorMsg)).trim();
        if (!sanitizedError) {
          return;
        }
        ws.send(JSON.stringify({
          type: 'gemini-error',
          error: sanitizedError
        }));
        return;
      }
      
      ws.send(JSON.stringify({
        type: 'gemini-error',
        error: errorMsg
      }));
    });
    
    // Handle process completion
    geminiProcess.on('close', async (code) => {
      // console.log(`Gemini CLI process exited with code ${code}`);
      clearTimeout(timeout);
      
      if (cliProvider === 'codex' && codexLineBuffer.trim()) {
        try {
          const event = JSON.parse(codexLineBuffer.trim());
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
            fullResponse += (fullResponse ? '\n' : '') + event.item.text;
          }
        } catch (e) {
        }
      }
      
      // Flush any remaining buffered content
      if (responseHandler) {
        responseHandler.forceFlush();
        responseHandler.destroy();
      }
      
      // Clean up process reference
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeGeminiProcesses.delete(finalSessionId);
      
      // Save assistant response to session if we have one
      if (finalSessionId && fullResponse) {
        sessionManager.addMessage(finalSessionId, 'assistant', fullResponse);
      }
      
      if (cliProvider === 'codex' && code !== 0 && codexStderrBuffer.trim()) {
        ws.send(JSON.stringify({
          type: 'gemini-error',
          error: codexStderrBuffer.trim()
        }));
      }

      if (cliProvider === 'ollama' && fullResponse.trim()) {
        ws.send(JSON.stringify({
          type: 'gemini-response',
          data: {
            type: 'message',
            content: fullResponse.trim()
          }
        }));
      }
      
      ws.send(JSON.stringify({
        type: 'gemini-complete',
        exitCode: code,
        isNewSession: !sessionId && !!command // Flag to indicate this was a new session
      }));
      
      // Clean up temporary image files if any
      if (geminiProcess.tempImagePaths && geminiProcess.tempImagePaths.length > 0) {
        for (const imagePath of geminiProcess.tempImagePaths) {
          await fs.unlink(imagePath).catch(err => {
            // console.error(`Failed to delete temp image ${imagePath}:`, err)
          });
        }
        if (geminiProcess.tempDir) {
          await fs.rm(geminiProcess.tempDir, { recursive: true, force: true }).catch(err => {
            // console.error(`Failed to delete temp directory ${geminiProcess.tempDir}:`, err)
          });
        }
      }
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${providerLabel} CLI exited with code ${code}`));
      }
    });
    
    // Handle process errors
    geminiProcess.on('error', (error) => {
      // console.error('Gemini CLI process error:', error);
      
      // Clean up process reference on error
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeGeminiProcesses.delete(finalSessionId);
      
      ws.send(JSON.stringify({
        type: 'gemini-error',
        error: error.message
      }));
      
      reject(error);
    });
    
    // Handle stdin for interactive mode
    // Gemini with positional prompt doesn't need stdin
    if (command && command.trim()) {
      // We're using a positional prompt, so just close stdin
      geminiProcess.stdin.end();
    } else {
      // Interactive mode without initial prompt
      // Keep stdin open for interactive use
    }
  });
}

function abortGeminiSession(sessionId) {
  // Debug - Attempting to abort Gemini session
  // Debug - Active processes
  
  // Try to find the process by session ID or any key that contains the session ID
  let process = activeGeminiProcesses.get(sessionId);
  let processKey = sessionId;
  
  if (!process) {
    // Search for process with matching session ID in keys
    for (const [key, proc] of activeGeminiProcesses.entries()) {
      if (key.includes(sessionId) || sessionId.includes(key)) {
        process = proc;
        processKey = key;
        break;
      }
    }
  }
  
  if (process) {
    // Debug - Found process for session
    try {
      // First try SIGTERM
      process.kill('SIGTERM');
      
      // Set a timeout to force kill if process doesn't exit
      setTimeout(() => {
        if (activeGeminiProcesses.has(processKey)) {
          // Debug - Process didn't terminate, forcing kill
          try {
            process.kill('SIGKILL');
          } catch (e) {
            // console.error('Error force killing process:', e);
          }
        }
      }, 2000); // Wait 2 seconds before force kill
      
      activeGeminiProcesses.delete(processKey);
      return true;
    } catch (error) {
      // console.error('Error killing process:', error);
      activeGeminiProcesses.delete(processKey);
      return false;
    }
  }
  
  // Debug - No process found for session
  return false;
}

export {
  spawnGemini,
  abortGeminiSession
};
