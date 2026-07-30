const { execSync } = require('child_process');

try {
  const output = execSync('npx vitest run --coverage', { encoding: 'utf8', stdio: 'pipe' });
  console.log(output);
} catch (error) {
  console.log(error.stdout);
  console.log(error.stderr);
  
  // Check if coverage was generated despite test failures
  if (error.stdout.includes('Coverage for branches')) {
    const branchMatch = error.stdout.match(/Coverage for branches \(([0-9.]+)%\)/);
    if (branchMatch) {
      console.log(`\n=== BRANCH COVERAGE: ${branchMatch[1]}% ===`);
    }
  }
  
  if (error.stderr.includes('ERROR: Coverage for branches')) {
    console.log('\n=== COVERAGE ERROR FOUND ===');
  }
}