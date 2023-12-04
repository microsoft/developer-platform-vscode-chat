const path = require('path');
const fs = require('fs')
if (process.argv.length < 3 || process.argv[2][0] !== 'v') {
	console.log('Syntax: node update-version.js v0.0.9\n\nVersion must start with v');
	process.exit(1);
}
const versionWithoutV = process.argv[2].substr(1);
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const pkgJsonText = fs.readFileSync(packageJsonPath, 'utf8');
const updatedText = pkgJsonText.replace(/"version"\s*:\s*".+"/, `"version":"${versionWithoutV}"`)
fs.writeFileSync(packageJsonPath, updatedText, 'utf8');
console.log(`Updated version in package.json to ${versionWithoutV}`);
