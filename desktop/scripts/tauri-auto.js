#!/usr/bin/env node
/**
 * Auto-detect GPU and run Tauri with appropriate features.
 */

const { execSync } = require('child_process');
const os = require('os');

function appendEnvFlag(currentValue, flag) {
  if (!currentValue) {
    return flag;
  }

  return currentValue.includes(flag) ? currentValue : `${currentValue} ${flag}`;
}

const command = process.argv[2];
if (!command || !['dev', 'build'].includes(command)) {
  console.error('Usage: node tauri-auto.js [dev|build]');
  process.exit(1);
}

let feature = '';

if (process.env.TAURI_GPU_FEATURE) {
  feature = process.env.TAURI_GPU_FEATURE;
  console.log(`Using forced GPU feature from environment: ${feature}`);
} else {
  try {
    const result = execSync('node scripts/auto-detect-gpu.js', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    feature = result.trim();
  } catch (_err) {
    // If detection fails, continue with no extra features.
  }
}

console.log('');

const platform = os.platform();
const env = { ...process.env };

if (feature === 'cuda') {
  const cudaArchitectures = '75;80;86;89;90';

  if (platform === 'linux') {
    console.log('Linux/CUDA detected: setting CMake flags for NVIDIA GPU');
    env.CMAKE_CUDA_ARCHITECTURES = cudaArchitectures;
    env.CMAKE_CUDA_STANDARD = '17';
    env.CMAKE_POSITION_INDEPENDENT_CODE = 'ON';
  } else if (platform === 'win32') {
    console.log('Windows/CUDA detected: setting CMake flags for NVIDIA GPU');
    console.log(`  CMAKE_CUDA_ARCHITECTURES=${cudaArchitectures}`);
    console.log('  Enabling MSVC conforming preprocessor: /Zc:preprocessor');
    env.CMAKE_CUDA_ARCHITECTURES = cudaArchitectures;
    env.CMAKE_CUDA_STANDARD = '17';
    env.CL = appendEnvFlag(env.CL, '/Zc:preprocessor');
  }
}

let tauriCmd = `tauri ${command}`;
if (feature && feature !== 'none') {
  tauriCmd += ` -- --features ${feature}`;
  console.log(`Running: tauri ${command} with features: ${feature}`);
} else {
  console.log(`Running: tauri ${command} (CPU-only mode)`);
}
console.log('');

try {
  execSync(tauriCmd, { stdio: 'inherit', env });
} catch (err) {
  process.exit(err.status || 1);
}
