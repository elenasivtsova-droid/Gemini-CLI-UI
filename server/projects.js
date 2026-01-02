import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import { getProjectConfigPath, getProjectsRoot } from './cli-config.js';

// Cache for extracted project directories
const projectDirectoryCache = new Map();
let cacheTimestamp = Date.now();

function decodeProjectNameToPath(projectName) {
  if (!projectName) return null;

  const tryDecode = (name, encoding) => {
    try {
      return Buffer.from(name, encoding).toString('utf8');
    } catch {
      return null;
    }
  };

  // New encoding: base64url (no padding)
  // Old encoding: base64 with all [/+=] replaced by '_' (often leaves trailing '_' as padding artifacts)
  const base64UrlCandidate = projectName.replace(/[_-]+$/, '');
  let decoded =
    tryDecode(base64UrlCandidate, 'base64url') ??
    tryDecode(projectName, 'base64url');

  if (!decoded) {
    // Legacy fallback used across the codebase historically
    const legacy = projectName.replace(/_/g, '+').replace(/-/g, '/');
    decoded = tryDecode(legacy, 'base64');
  }

  if (!decoded) return null;

  decoded = decoded.replace(/[^\x20-\x7E]/g, '').trim();

  // Heuristic cleanup for legacy-encoded names that decoded with a stray trailing character.
  // Only apply if it helps resolve to a real path.
  if (path.isAbsolute(decoded)) {
    const direct = decoded;
    const minusOne = decoded.slice(0, -1);
    const minusTwo = decoded.slice(0, -2);

    try {
      if (fsSync.existsSync(direct)) return direct;
      if (minusOne && fsSync.existsSync(minusOne)) return minusOne;
      if (minusTwo && fsSync.existsSync(minusTwo)) return minusTwo;
    } catch {
      // ignore fs errors, fall through to returning decoded
    }
  }

  return decoded;
}

function encodeProjectPathToName(absolutePath) {
  return Buffer.from(absolutePath).toString('base64url');
}

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
  cacheTimestamp = Date.now();
}

// Load project configuration file
async function loadProjectConfig(providerOverride = null) {
  const configPath = getProjectConfigPath(providerOverride);
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

// Save project configuration file
async function saveProjectConfig(config, providerOverride = null) {
  const configPath = getProjectConfigPath(providerOverride);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || decodeProjectNameToPath(projectName) || projectName.replace(/-/g, '/');
  
  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);
    
    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }
  
  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    if (parts.length > 3) {
      // Show last 2 folders with ellipsis: "...projects/myapp"
      return `.../${parts.slice(-2).join('/')}`;
    } else {
      // Show full path if short: "/home/user"
      return projectPath;
    }
  }
  
  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(projectName, providerOverride = null) {
  // Check cache first
  const cacheKey = `${providerOverride || 'default'}::${projectName}`;
  if (projectDirectoryCache.has(cacheKey)) {
    return projectDirectoryCache.get(cacheKey);
  }
  
  
  const projectDir = path.join(getProjectsRoot(providerOverride), projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions
      extractedPath = decodeProjectNameToPath(projectName) || projectName.replace(/-/g, '/');
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });
        
        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              
              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);
                
                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }
      
      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name
        extractedPath = projectName.replace(/-/g, '/');
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());
        
        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }
        
        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          extractedPath = latestCwd || decodeProjectNameToPath(projectName) || projectName.replace(/-/g, '/');
        }
      }
    }
    
    // Clean the extracted path by removing any non-printable characters
    extractedPath = extractedPath.replace(/[^\x20-\x7E]/g, '').trim();
    
    // Cache the result
    projectDirectoryCache.set(cacheKey, extractedPath);
    
    return extractedPath;
    
  } catch (error) {
    // console.error(`Error extracting project directory for ${projectName}:`, error);
    // Fall back to decoded project name
    extractedPath = decodeProjectNameToPath(projectName) || projectName.replace(/-/g, '/');
    
    // Cache the fallback result too
    projectDirectoryCache.set(cacheKey, extractedPath);
    
    return extractedPath;
  }
}

async function getProjects(providerOverride = null) {
  const geminiDir = getProjectsRoot(providerOverride);
  const config = await loadProjectConfig(providerOverride);
  const projects = [];
  const existingProjects = new Set();
  
  try {
    await fs.mkdir(geminiDir, { recursive: true });
    // First, get existing projects from the file system
    const entries = await fs.readdir(geminiDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        existingProjects.add(entry.name);
        const projectPath = path.join(geminiDir, entry.name);
        
        // Extract actual project directory from JSONL sessions
        const actualProjectDir = await extractProjectDirectory(entry.name, providerOverride);
        
        // Get display name from config or generate one
        const customName = config[entry.name]?.displayName;
        const autoDisplayName = await generateDisplayName(entry.name, actualProjectDir);
        const fullPath = actualProjectDir;
        
        const project = {
          name: entry.name,
          path: actualProjectDir,
          displayName: customName || autoDisplayName,
          fullPath: fullPath,
          isCustomName: !!customName,
          sessions: []
        };
        
        // Try to get sessions for this project (just first 5 for performance)
        try {
          // Use sessionManager to get sessions for this project
          const sessionManager = (await import('./sessionManager.js')).default;
          const allSessions = sessionManager.getProjectSessions(actualProjectDir);
          
          // Paginate the sessions
          const paginatedSessions = allSessions.slice(0, 5);
          project.sessions = paginatedSessions;
          project.sessionMeta = {
            hasMore: allSessions.length > 5,
            total: allSessions.length
          };
        } catch (e) {
          // console.warn(`Could not load sessions for project ${entry.name}:`, e.message);
        }
        
        projects.push(project);
      }
    }
  } catch (error) {
    // console.error('Error reading projects directory:', error);
  }
  
  // Add manually configured projects that don't exist as folders yet
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      // Use the original path if available, otherwise extract from potential sessions
      let actualProjectDir = projectConfig.originalPath;
      
      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          // Fall back to decoded project name
          actualProjectDir = projectName.replace(/-/g, '/');
        }
      }
      
              const project = {
          name: projectName,
          path: actualProjectDir,
          displayName: projectConfig.displayName || await generateDisplayName(projectName, actualProjectDir),
          fullPath: actualProjectDir,
          isCustomName: !!projectConfig.displayName,
          isManuallyAdded: true,
          sessions: []
        };
      
      projects.push(project);
    }
  }
  
  return projects;
}

async function getSessions(projectName, limit = 5, offset = 0, providerOverride = null) {
  const projectDir = path.join(getProjectsRoot(providerOverride), projectName);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }
    
    // For performance, get file stats to sort by modification time
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    
    // Sort files by modification time (newest first) for better performance
    filesWithStats.sort((a, b) => b.mtime - a.mtime);
    
    const allSessions = new Map();
    let processedCount = 0;
    
    // Process files in order of modification time
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const sessions = await parseJsonlSessions(jsonlFile);
      
      // Merge sessions, avoiding duplicates by session ID
      sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });
      
      processedCount++;
      
      // Early exit optimization: if we have enough sessions and processed recent files
      if (allSessions.size >= (limit + offset) * 2 && processedCount >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }
    
    // Convert to array and sort by last activity
    const sortedSessions = Array.from(allSessions.values()).sort((a, b) => 
      new Date(b.lastActivity) - new Date(a.lastActivity)
    );
    
    const total = sortedSessions.length;
    const paginatedSessions = sortedSessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    
    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    // console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    // Debug - [JSONL Parser] Reading file
    let lineCount = 0;
    
    for await (const line of rl) {
      if (line.trim()) {
        lineCount++;
        try {
          const entry = JSON.parse(line);
          
          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || ''
              });
            }
            
            const session = sessions.get(entry.sessionId);
            
            // Update summary if this is a summary entry
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            } else if (entry.message?.role === 'user' && entry.message?.content && session.summary === 'New Session') {
              // Use first user message as summary if no summary entry exists
              const content = entry.message.content;
              if (typeof content === 'string' && content.length > 0) {
                // Skip command messages that start with <command-name>
                if (!content.startsWith('<command-name>')) {
                  session.summary = content.length > 50 ? content.substring(0, 50) + '...' : content;
                }
              }
            }
            
            // Count messages instead of storing them all
            session.messageCount = (session.messageCount || 0) + 1;
            
            // Update last activity
            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          // console.warn(`[JSONL Parser] Error parsing line ${lineCount}:`, parseError.message);
        }
      }
    }
    
    // Debug - [JSONL Parser] Processed lines and found sessions
  } catch (error) {
    // console.error('Error reading JSONL file:', error);
  }
  
  // Convert Map to Array and sort by last activity
  return Array.from(sessions.values()).sort((a, b) => 
    new Date(b.lastActivity) - new Date(a.lastActivity)
  );
}

// Get messages for a specific session
async function getSessionMessages(projectName, sessionId, providerOverride = null) {
  const projectDir = path.join(getProjectsRoot(providerOverride), projectName);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      return [];
    }
    
    const messages = [];
    
    // Process all JSONL files to find messages for this session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = fsSync.createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            // console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    }
    
    // Sort messages by timestamp
    return messages.sort((a, b) => 
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );
  } catch (error) {
    // console.error(`Error reading messages for session ${sessionId}:`, error);
    return [];
  }
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName, providerOverride = null) {
  const config = await loadProjectConfig(providerOverride);
  
  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, will fall back to auto-generated
    delete config[projectName];
  } else {
    // Set custom display name
    config[projectName] = {
      displayName: newDisplayName.trim()
    };
  }
  
  await saveProjectConfig(config, providerOverride);
  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId, providerOverride = null) {
  const projectDir = path.join(getProjectsRoot(providerOverride), projectName);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      throw new Error('No session files found for this project');
    }
    
    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Check if this file contains the session
      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });
      
      if (hasSession) {
        // Filter out all entries for this session
        const filteredLines = lines.filter(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId !== sessionId;
          } catch {
            return true; // Keep malformed lines
          }
        });
        
        // Write back the filtered content
        await fs.writeFile(jsonlFile, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
        return true;
      }
    }
    
    throw new Error(`Session ${sessionId} not found in any files`);
  } catch (error) {
    // console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    // console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete an empty project
async function deleteProject(projectName, providerOverride = null) {
  const projectDir = path.join(getProjectsRoot(providerOverride), projectName);
  
  try {
    // First check if the project is empty
    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty) {
      throw new Error('Cannot delete project with existing sessions');
    }
    
    // Remove the project directory
    await fs.rm(projectDir, { recursive: true, force: true });
    
    // Remove from project config
    const config = await loadProjectConfig(providerOverride);
    delete config[projectName];
    await saveProjectConfig(config, providerOverride);
    
    return true;
  } catch (error) {
    // console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

// Add a project manually to the config (create folder if needed)
async function addProjectManually(projectPath, displayName = null, providerOverride = null) {
  const absolutePath = path.resolve(projectPath);
  
  try {
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    // If path doesn't exist, try to create it
    if (error.code === 'ENOENT') {
      try {
        await fs.mkdir(absolutePath, { recursive: true });
        console.log(`Created new directory: ${absolutePath}`);
      } catch (mkdirError) {
        throw new Error(`Failed to create directory: ${absolutePath} - ${mkdirError.message}`);
      }
    } else {
      throw new Error(`Cannot access path: ${absolutePath} - ${error.message}`);
    }
  }
  
  // Generate project name (encode path for use as directory name)
  // Use base64url encoding to handle all path characters safely (and decode losslessly)
  const projectName = encodeProjectPathToName(absolutePath);
  
  // Check if project already exists in config or as a folder
  const config = await loadProjectConfig(providerOverride);
  const projectDir = path.join(getProjectsRoot(providerOverride), projectName);
  
  try {
    await fs.access(projectDir);
    throw new Error(`Project already exists for path: ${absolutePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  
  if (config[projectName]) {
    throw new Error(`Project already configured for path: ${absolutePath}`);
  }
  
  // Add to config as manually added project
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };
  
  if (displayName) {
    config[projectName].displayName = displayName;
  }
  
  await saveProjectConfig(config, providerOverride);
  
  // Create the project directory
  try {
    await fs.mkdir(projectDir, { recursive: true });
  } catch (error) {
    // console.error('Error creating project directory:', error);
  }
  
  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    sessions: []
  };
}


export {
  getProjects,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache
};
