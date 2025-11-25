#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

async function mergeJsonFiles() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node merge-sessions.js <input1.json> <input2.json> [...] <output.json>');
    console.error('Example: node merge-sessions.js file1.json file2.json file3.json merged.json');
    process.exit(1);
  }

  const outputFile = args[args.length - 1];
  const inputFiles = args.slice(0, -1);

  try {
    let mergedData = null;

    for (let i = 0; i < inputFiles.length; i++) {
      const filePath = inputFiles[i];
      console.log(`Reading ${filePath}...`);
      
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);

      if (i === 0) {
        // First file: use as base, keeping meta block
        mergedData = data;
      } else {
        // Subsequent files: append arrays from matching keys
        for (const key in data) {
          if (key === 'meta') {
            // Skip meta block for subsequent files
            continue;
          }
          
          if (Array.isArray(data[key])) {
            if (Array.isArray(mergedData[key])) {
              // Append to existing array
              mergedData[key].push(...data[key]);
            } else {
              // Create new array if it doesn't exist
              mergedData[key] = [...data[key]];
            }
          }
        }
      }
    }

    // Write merged data to output file
    console.log(`Writing merged data to ${outputFile}...`);
    await fs.writeFile(outputFile, JSON.stringify(mergedData), 'utf8');
    
    console.log(`✓ Successfully merged ${inputFiles.length} files into ${outputFile}`);
    
    // Print summary
    console.log('\nSummary:');
    for (const key in mergedData) {
      if (Array.isArray(mergedData[key])) {
        console.log(`  ${key}: ${mergedData[key].length} items`);
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

mergeJsonFiles();
