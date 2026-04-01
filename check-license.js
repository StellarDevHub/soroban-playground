const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const licenseFile = path.join(rootDir, 'LICENSE');
const packageFiles = [
  path.join(rootDir, 'package.json'),
  path.join(rootDir, 'frontend', 'package.json'),
  path.join(rootDir, 'backend', 'package.json'),
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!fs.existsSync(licenseFile)) {
  fail('Missing LICENSE file at repository root.');
}

for (const packageFile of packageFiles) {
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));

  if (!pkg.license || typeof pkg.license !== 'string') {
    fail(`Missing or invalid license field in ${path.relative(rootDir, packageFile)}.`);
  }
}

if (process.exitCode !== 1) {
  console.log('License metadata looks good.');
}
