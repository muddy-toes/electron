#!/usr/bin/env node

const fs = require('fs').promises;

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

async function analyzeDuration() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node session-duration.js <input.json>');
    process.exit(1);
  }

  const inputFile = args[0];

  try {
    console.log(`Reading ${inputFile}...`);
    
    const content = await fs.readFile(inputFile, 'utf8');
    const data = JSON.parse(content);

    const durations = {};
    let maxDuration = 0;
    let maxKey = null;

    for (const key in data) {
      if (key === 'meta') continue;
      
      if (Array.isArray(data[key])) {
        const totalMs = data[key].reduce((sum, item) => sum + (item.stamp || 0), 0);
        durations[key] = totalMs;
        
        if (totalMs > maxDuration) {
          maxDuration = totalMs;
          maxKey = key;
        }
      }
    }

    // Print the longest
    if (maxKey) {
      console.log(`\nDuration: ${formatDuration(maxDuration)}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

analyzeDuration();

