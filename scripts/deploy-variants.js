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
    console.error('::error::未发现任何以 KV 开头的 Repository Variables。请在 GitHub Repo → Settings → Secrets and variables → Actions → Variables 中至少配置一个 KV=<实际KV namespace id>（可选再配 KV_1、KV1 等实现多副本）');
    process.exit(1);
}

console.log('\n📋 将要部署的 Worker 列表：');
entries.forEach(e => console.log(
    `  - Variable ${e.varKey} → Worker ${e.workerName}  |  KV binding 名 ${e.kvBinding}  |  id = ${e.kvId}`
));
console.log();

for (const e of entries) {
    console.log(`\n===== Deploying: ${e.workerName} =====`);

    const configPath = `wrangler.${e.workerName}.toml`;
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
    console.log('Generated ' + configPath + ':');
    console.log(fs.readFileSync(configPath, 'utf8'));

    try {
        run(`npx wrangler deploy --config ${configPath}`);
        console.log(`✅ ${e.workerName} 部署成功`);
    } finally {
        try { fs.unlinkSync(configPath); } catch (_) { }
    }
}

console.log('\n🎉 全部部署完成：');
entries.forEach(e => console.log(`  - ${e.workerName}  (KV: ${e.kvTitle})`));