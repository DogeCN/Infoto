const fs = require('fs');
const { execSync } = require('child_process');

const run = (cmd, { echo = true } = {}) => {
    if (echo) console.log('\n$ ' + cmd);
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
    if (echo && out.trim()) console.log(out.trim());
    return out;
};

let vars = {};
try {
    vars = JSON.parse(process.env.VARS_JSON || '{}');
} catch (e) {
    console.log('⚠️  VARS_JSON 解析失败，回退为空对象');
    vars = {};
}

const entries = Object.entries(vars)
    .filter(([k]) => k === 'KV' || /^KV[^a-zA-Z]/.test(k) || /^KV[0-9]/.test(k))
    .map(([k, id]) => {
        const suffix = k === 'KV' ? '' : k.slice('KV'.length);
        return {
            varKey: k,
            suffix,
            workerName: 'infoto' + suffix.toLowerCase(),
            kvBinding: 'Infoto',
            kvTitle: 'Infoto' + suffix,
            kvId: String(id).trim(),
        };
    });

if (entries.length === 0) {
    console.log('ℹ️  未发现任何以 KV 开头的 Repository Variables，将仅使用 wrangler.toml 默认配置部署主环境');
    entries.push({
        varKey: '(wrangler.toml)',
        suffix: '',
        workerName: 'infoto',
        kvBinding: 'Infoto',
        kvTitle: 'Infoto',
        kvId: null,
    });
}

const usingDefaultWrangler = entries.some(e => e.kvId === null);
if (usingDefaultWrangler) {
    const toml = fs.readFileSync('wrangler.toml', 'utf8');
    if (/REPLACE_WITH_KV_ID/.test(toml)) {
        console.error('::error::使用 wrangler.toml 默认部署但其中 KV id 仍是占位符。请在 Repository Variables 中设置 KV=<实际id>，或回填 wrangler.toml 中的 id。');
        process.exit(1);
    }
}

console.log('\n📋 将要部署的 Worker 列表：');
entries.forEach(e => console.log(
    `  - Variable ${e.varKey} → Worker ${e.workerName}  |  KV binding 名 ${e.kvBinding}  |  id = ${e.kvId || '(from wrangler.toml)'}`
));
console.log();

for (const e of entries) {
    console.log(`\n===== Deploying: ${e.workerName} =====`);

    let configPath = 'wrangler.toml';
    let tempCreated = false;

    if (e.kvId) {
        configPath = `wrangler.${e.workerName}.toml`;
        fs.writeFileSync(configPath, [
            `name = "${e.workerName}"`,
            'main = "src/worker.js"',
            'compatibility_date = "2026-07-15"',
            '',
            '[assets]',
            'directory = "./public"',
            'binding = "ASSETS"',
            '',
            '[[kv_namespaces]]',
            `binding = "${e.kvBinding}"`,
            `id = "${e.kvId}"`,
            '',
        ].join('\n'));
        tempCreated = true;
        console.log('Generated ' + configPath + ':');
        console.log(fs.readFileSync(configPath, 'utf8'));
    } else {
        console.log('Using default wrangler.toml');
    }

    try {
        run(`npx wrangler deploy --config ${configPath}`);
        console.log(`✅ ${e.workerName} 部署成功`);
    } finally {
        if (tempCreated) {
            try { fs.unlinkSync(configPath); } catch (_) { }
        }
    }
}

console.log('\n🎉 全部部署完成：');
entries.forEach(e => console.log(`  - ${e.workerName}  (KV: ${e.kvTitle})`));