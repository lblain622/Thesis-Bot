const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', '.idea', 'node_modules', 'Microsoft']);

function findJavaScriptFiles(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        if (entry.isDirectory()) {
            if (ignoredDirectories.has(entry.name)) return [];
            return findJavaScriptFiles(path.join(directory, entry.name));
        }
        return entry.isFile() && entry.name.endsWith('.js') ? [path.join(directory, entry.name)] : [];
    });
}

const files = findJavaScriptFiles(root);
const failures = [];

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
    if (result.status !== 0) failures.push(result.stderr.trim());
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
