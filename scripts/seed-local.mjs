// 本地开发示例数据：向 wrangler dev 的 /sync 灌入一批照片元数据 + 标记。
// 用法：node scripts/seed-local.mjs [--count 24] [--uuid <uuid>]
// 依赖 web/public/mock-img/imgN.svg（本地占位图，不进仓库）。

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ORIGIN = argOf('origin', 'http://127.0.0.1:8787');
const COUNT = Number(argOf('count', '24'));
const UUID = argOf('uuid', '');
/** wrangler dev 的 always-pass 测试 secret 配套的 dummy token。 */
const DUMMY_TURNSTILE = 'XXXX.DUMMY.TOKEN.XXXX';

const WIDTHS = [1200, 800, 1000, 1400, 900, 700, 1600, 1080];
const RATIOS = [0.66, 1.5, 1.0, 0.75, 1.33, 0.56, 1.78, 0.8];

let seed = 20260925;
const rnd = () => {
	// xorshift：不依赖 Math.random，每次运行结果一致
	seed ^= seed << 13;
	seed ^= seed >>> 17;
	seed ^= seed << 5;
	return ((seed >>> 0) % 100000) / 100000;
};

const sha = (i) => `localmock${i.toString(16).padStart(4, '0')}${Math.floor(rnd() * 1e16).toString(36)}`;

let cookie = UUID ? `uuid=${UUID}` : '';

/** 首次调用 /sync 时若被要求 Turnstile，用 always-pass 的 dummy token 建立身份并记住 cookie。 */
async function bootstrap() {
	if (cookie) return;
	const res = await fetch(`${ORIGIN}/sync`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ turnstileToken: DUMMY_TURNSTILE, ops: [] }),
	});
	const setCookies = res.headers.getSetCookie?.() ?? [];
	const uuidCookie = setCookies.find((c) => c.startsWith('uuid='));
	if (!res.ok || !uuidCookie) {
		throw new Error(`identity bootstrap failed: ${res.status} ${await res.text()}`);
	}
	cookie = uuidCookie.split(';')[0];
	console.log(`identity: ${cookie}`);
}

async function sync(ops) {
	await bootstrap();
	const res = await fetch(`${ORIGIN}/sync`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Cookie: cookie },
		body: JSON.stringify({ ops }),
	});
	if (!res.ok) throw new Error(`/sync ${res.status}: ${await res.text()}`);
	return res.json();
}

const uploads = [];
for (let i = 0; i < COUNT; i++) {
	const w = WIDTHS[i % WIDTHS.length];
	const h = Math.round(w / RATIOS[(i * 3 + 1) % RATIOS.length]);
	uploads.push({
		type: 'upload',
		payload: {
			sha256: sha(i),
			url: `/mock-img/img${i}.svg`,
			width: w,
			height: h,
			size: 300000 + i * 97013,
			// type 0=图片 1=无声动图 2=有声视频
			type: i % 7 === 3 ? 2 : i % 11 === 5 ? 1 : 0,
		},
	});
}

const first = await sync(uploads);
const photos = first.photos ?? [];

const marks = [];
for (const p of photos) {
	if (rnd() < 0.5) marks.push({ type: 'like', target: p.id });
	if (rnd() < 0.15) marks.push({ type: 'dislike', target: p.id });
	if (rnd() < 0.08) marks.push({ type: 'report', target: p.id });
}
if (marks.length > 0) await sync(marks);

console.log(`seeded ${uploads.length} uploads + ${marks.length} marks → ${photos.length} photos (${cookie})`);
