// JXL 编码 Web Worker（module worker）
// 把 libjxl 的 WASM 编码从主线程移出，消除上传时的界面卡顿。
// 主线程通过 postMessage 传入 ImageData 的像素缓冲（零拷贝转移），
// 返回编码后的 ArrayBuffer（也以转移方式回传，避免大图二次复制）。

let encode = null;
let loading = null;

async function getEncode() {
    if (encode) return encode;
    if (!loading) loading = import('https://cdn.jsdelivr.net/npm/@jsquash/jxl@1.2.0/+esm');
    const mod = await loading;
    encode = mod.encode;
    return encode;
}

self.onmessage = async (e) => {
    const { id, width, height, buffer } = e.data;
    try {
        const enc = await getEncode();
        const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
        const out = await enc(imageData, { lossless: true, effort: 7 });
        const ab = out instanceof ArrayBuffer ? out : out.buffer;
        // 转移回传，零拷贝
        self.postMessage({ id, ok: true, buf: ab }, [ab]);
    } catch (err) {
        self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
};
