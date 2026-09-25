// Turnstile first-entry flow (spec: "身份与 Cookie"):
// explicit rendering (theme dark) → the token rides exactly one first /sync →
// afterwards Turnstile never appears in any flow again.

import { TurnstileRequiredError, postSync } from './api/syncClient';
import type { Op, SyncResponse } from '$shared/types';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Dev fallback site key (Cloudflare's always-passing test key). */
const DEV_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export interface TurnstileFlowDeps {
	/** Injected for unit tests and E2E. */
	postSyncFn?: typeof postSync;
	/** Token getter; injectable to skip the real widget (E2E / test key). */
	getTokenFn?: (siteKey: string, container: HTMLElement) => Promise<string>;
}

interface TurnstileRenderOptions {
	sitekey: string;
	theme?: string;
	callback?: (token: string) => void;
	'error-callback'?: () => void;
	'timeout-callback'?: () => void;
}

interface TurnstileApi {
	render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId: string) => void;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
	if (scriptPromise) return scriptPromise;
	scriptPromise = new Promise((resolve, reject) => {
		const w = window as unknown as { turnstile?: TurnstileApi };
		if (w.turnstile) return resolve(w.turnstile);
		const s = document.createElement('script');
		s.src = TURNSTILE_SCRIPT;
		s.async = true;
		s.onload = () => {
			if (w.turnstile) resolve(w.turnstile);
			else reject(new Error('turnstile api missing'));
		};
		s.onerror = () => reject(new Error('turnstile script load failed'));
		document.head.appendChild(s);
	});
	return scriptPromise;
}

/**
 * 已渲染但尚未销毁的 widget id。Turnstile 内部持有轮询定时器，
 * 直接摘 DOM 节点会留下悬空 widget（控制台刷 "Cannot find Widget" +
 * iframe postMessage 报错），必须先 turnstile.remove(id)。
 */
let activeWidgetId: string | null = null;

/** 销毁当前 widget（幂等）。 */
export async function disposeTurnstile(): Promise<void> {
	const id = activeWidgetId;
	activeWidgetId = null;
	if (!id) return;
	try {
		const ts = await loadTurnstile();
		ts.remove(id);
	} catch {
		// 脚本都没加载成功时无 widget 可销毁
	}
}

/** Turnstile 无回调的兜底超时：widget 挂住时不能把首屏引导一起挂死。 */
const TURNSTILE_TIMEOUT_MS = 15_000;

/**
 * Render Turnstile explicitly and wait for the token.
 * widget 挂住（iframe 加载不下来/被拦）时按超时 reject，让调用方走降级路径。
 */
export async function renderTurnstile(
	siteKey: string,
	container: HTMLElement,
	timeoutMs = TURNSTILE_TIMEOUT_MS,
): Promise<string> {
	const ts = await loadTurnstile();
	// 上一个 widget 未清干净时先销毁，避免同容器重复 render
	await disposeTurnstile();
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn: (v: never) => void, v: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(v as never);
		};
		const timer = setTimeout(() => finish(reject, new Error('turnstile_timeout')), timeoutMs);
		container.innerHTML = '';
		activeWidgetId = ts.render(container, {
			sitekey: siteKey,
			theme: 'dark',
			callback: (token: string) => finish(resolve, token),
			'error-callback': () => finish(reject, new Error('turnstile_error')),
			'timeout-callback': () => finish(reject, new Error('turnstile_timeout')),
		});
	});
}

export interface IdentityBootstrapResult {
	response: SyncResponse;
	/** true = this was a first entry (identity created with a Turnstile token). */
	firstEntry: boolean;
}

/**
 * First-entry flow = one Turnstile check + two /sync calls (spec wording).
 * With a valid cookie (no 401) the full snapshot returns directly and
 * Turnstile never shows up.
 *
 * 首访服务端 401 turnstile_required 时才渲染 Turnstile。
 *
 * 注意：身份 cookie（uuid）是 HttpOnly，前端读不到 document.cookie —— 任何
 * 「本地判断有没有身份、没有就直接进 Turnstile」的优化都是错的：老用户每次刷新
 * 都会被迫再验一次验证码。是否已认证只能由服务端回答，所以永远先探测 /sync。
 */
export async function ensureIdentity(ops: Op[] = [], deps: TurnstileFlowDeps = {}): Promise<IdentityBootstrapResult> {
	const sync = deps.postSyncFn ?? postSync;
	let serverSiteKey: string | null = null;
	try {
		const { response } = await sync({ ops });
		return { response, firstEntry: false };
	} catch (e) {
		if (!(e instanceof TurnstileRequiredError)) throw e;
		serverSiteKey = e.turnstileSiteKey;
	}
	{
		const siteKey = serverSiteKey ?? DEV_SITE_KEY ?? null;
		if (!siteKey) throw new Error('turnstile_required but no site key');
		const container = document.createElement('div');
		container.id = 'infoto-turnstile';
		container.style.position = 'fixed';
		container.style.inset = '0';
		container.style.display = 'grid';
		container.style.placeItems = 'center';
		container.style.zIndex = '9999';
		container.style.background = '#0a0e1a';
		document.body.appendChild(container);
		try {
			const getToken = deps.getTokenFn ?? renderTurnstile;
			const token = await getToken(siteKey, container);
			// the token rides exactly one first /sync
			const { response } = await sync({ turnstileToken: token, ops });
			return { response, firstEntry: true };
		} finally {
			// 遮挡层立刻隐藏（不让用户看到多余的黑屏），widget 稍后再销毁：
			// token 刚回来时 Turnstile iframe 的收尾握手还没发完，立刻 remove 会让
			// 它的 postMessage 打到已拆除的窗口上（控制台报 target origin 不匹配）。
			// 延时窗口内若再次渲染，renderTurnstile 会先 dispose 上一次，不会漏。
			container.style.display = 'none';
			setTimeout(() => {
				void disposeTurnstile().finally(() => container.remove());
			}, 800);
		}
	}
}
