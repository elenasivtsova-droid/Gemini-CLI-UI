import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const parts = trimmedLine.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          if (key && value) {
            process.env[key] = value;
          }
        }
      }
    });
  }
} catch (e) {
  console.log('Error reading .env:', e.message);
}

// Try to find the API key
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error('No API key found in .env (checked GEMINI_API_KEY and GOOGLE_API_KEY)');
  console.log('Environment keys found:', Object.keys(process.env).filter(k => k.includes('KEY') || k.includes('API')));
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

console.log('Fetching models...');

fetch(url)
  .then(res => res.json())
  .then(data => {
    if (data.models) {
      console.log('\nAvailable Models:');
      data.models.forEach(m => {
        console.log(`- ${m.name.replace('models/', '')} (${m.displayName})`);
      });
    } else {
      console.error('Failed to list models:', JSON.stringify(data, null, 2));
    }
  })
  .catch(err => console.error('Error:', err));
