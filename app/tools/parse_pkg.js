const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));

for (const pkg of data.packages) {
    for (const tool of pkg.tools) {
        if (tool.name && tool.name.includes('xtensa-esp32-elf')) {
            console.log('\n工具: ' + tool.name);
            console.log('版本: ' + tool.version);
            for (const sys of tool.systems) {
                if (sys.host && sys.host.includes('mingw')) {
                    console.log('  Windows (' + sys.host + '):');
                    console.log('    URL: ' + sys.url);
                    console.log('    大小: ' + (sys.size / 1024 / 1024).toFixed(1) + ' MB');
                }
            }
        }
    }
}
