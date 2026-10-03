# 转码 / 哈希 / 落盘合成一条流，并修掉租约误回收

## Context

用户在视频转码时观察到两个现象，排查后是两个独立原因：

- **A（每次都发生）**：视频转码完成后并不直接上传，而是先落盘并哈希产出物。`onVideoResult`（`web/src/transcode/sw.ts:376-383`）先 `rec.phase = 'hashing'` + `notify(rec)`（不带 fraction → 行变 sweep），再 `storeArtifact` 从 byte 0 报进度 → 进度条看起来"跑到头 → 变 sweep → 从 0 重来"。实际上是换了测量对象（产出文件自己的哈希字节），但界面没有任何标识。
- **B（偶发，真丢工作）**：心跳是页面主线程的 `setInterval`（`web/src/transcode/lease.ts:77-79`，5s 一次），回收器 15s 收不到心跳就强制回收（`sw.ts:441-464`）→ `phase='lease-wait'` + `notify(rec)` → sweep，重新入队从头转码。后台标签页的定时器被浏览器节流到约 1 次/分钟，**必然**超过 15s，于是切走标签页就会丢掉已完成的编码并重来。

同时 `video.worker.ts:70` 用 mediabunny 的 `BufferTarget` 把整个 WebM 攒在内存里，再 `new Blob([buffer])`（又一份完整拷贝）跨线程交给 SharedWorker —— 峰值≈2×产物（上限 100MB → 200MB）。mediabunny 自己的注释就写着 `BufferTarget` "not suitable for very large files"。

**注意：哈希+落盘这一半已经是流式的。** `opfs.ts:19-44` 的 `storeArtifact` → `hashBlob` 用 `hash-wasm` 的增量 `createSHA256()`（`hash.ts:13-36`），每个 chunk 同时写 OPFS + 更新哈希，内存 O(chunk)。真正需要改的是**上游的编码产物物化**。

目标：把"编码 → 哈希 → 落盘"合成一条流。峰值内存从 O(产物) 降到 O(chunk)；视频不再有独立的 `hashing` 相位，A 从结构上消失。B 单独修存活策略。

## 设计

```
VideoEncoder ──chunk──► WritableStream<StreamTargetChunk> ──┬──► FileSystemWritableFileStream (OPFS)
                                                            └──► hash-wasm 增量 SHA-256
```

用 mediabunny 的 `StreamTarget`（`node_modules/mediabunny/dist/mediabunny.d.ts:4470`），官方注明"compatible with `FileSystemWritableFileStream`"且支持背压（背压会传导到编码器，顺带限流）。`StreamTargetChunk = { type:'write', data: Uint8Array, position: number }` —— 形状正好是 `FileSystemWritableFileStream.write()` 接受的 `{type:'write', data, position}`。

**不使用 `AppendOnlyStreamTarget`**：它要求格式严格顺序写、否则运行时抛错，而类型定义无法确认 WebM 是否满足（`target.d.ts:116-121` 只给出通用说明）。用 `StreamTarget` 不依赖这个假设。

**哈希的正确性**：`position` 的存在意味着理论上可能回写。写入路径记录 `expected`（下一个期望偏移）：

- `position === expected` → `hasher.update(data)`，`expected += data.byteLength`；
- 否则标记 `nonSequential = true`，此时**不能**信任流内摘要。

收尾时：顺序则用流内摘要；一旦 `nonSequential`，改为把刚写完的 OPFS 文件读回来重新哈希（`hashBlob` 已有的能力，内存仍是 O(chunk)）。这是运行期分支而非兼容性兜底 —— WebM 若不回写就走快路径，回写则保证哈希正确。

## 改动清单

### 1. `web/src/transcode/opfs.ts` — 新增共享的流式 sink

新增 `openArtifactSink(jobId, ext)`，返回：

- `chunkStream: WritableStream<{ type:'write'; data: Uint8Array; position: number }>` —— 供 `StreamTarget` 使用；
- `finish(): Promise<{ sha256: string; bytes: number }>` —— 关闭 writable 并给出摘要（含上面的 `nonSequential` 读回分支）；
- `abort(): Promise<void>` —— `writable.abort()` + `removeArtifact`，用于取消 / 租约回收 / 失败。

内部复用 `createSHA256`（`hash.ts` 已有依赖 `hash-wasm`），与 `storeArtifact` 的写法保持一致。`storeArtifact`（Blob 版）保留给**图片**路径 —— `canvas.convertToBlob()` 没有流式编码 API，图片产物有 50MB 解码上限、收益小，本轮不动。

### 2. `web/src/transcode/video.worker.ts` — 输出改流式

- `BufferTarget` → `StreamTarget`（`transcodeVideo` 与 `transcodeGif` 两处，含 VP8 fallback 那处的重建）。
- `transcodeVideo` 返回 `{ jobId, sha256, bytes, width, height, hasAudio, type }`，**不再返回 Blob**。
- `transcodeGif` 同改（它现在自己 `output.finalize()`，改为 finalize 后取 sink 的结果）。
- 进度仍用 `conversion.onProgress` / GIF 的逐帧 `progress()`（已是真实测量），覆盖"编码+封装+写盘+哈希"整段。
- 新增 `abortJob` 消息处理：`sink.abort()` → 回 `{ t:'aborted' }` → `self.close()`。

### 3. `web/src/transcode/protocol.ts` — 消息形状

- `VideoResultRequest`：删 `blob`，加 `sha256: string` 与 `bytes: number`（`hasAudio` 保留，SW 由此算 `type`）。同步更新 `PAGE_TYPES` / 运行期 guard 与 `protocol.test.ts`。
- 租约可见性（见第 6 点）：新增 `LeaseVisibilityRequest { t:'leaseVisibility'; leaseId: string; hidden: boolean }`。

### 4. `web/src/transcode/sw.ts`

- `onVideoResult` 改为接收 `{ sha256, bytes, width, height, hasAudio }`：直接设 `rec.sha256`、`rec.meta`、`rec.artifact`，然后 `afterStage1(rec)`。**视频/GIF 不再进入 `hashing` 相位**。
- `afterStage1`（`sw.ts:274`）那句 `notify(rec, { fraction: undefined })` 对视频路径会造成一次多余的无 fraction 通知（行离开面板前闪一下 sweep）；视频路径不再经历它。
- 图片路径完全不变（仍走 `storeArtifact` + `notifyBytes`）。
- 回收器（`sw.ts:441-464`）与 `forgetJob`：回收/丢弃时要删除可能存在的半成品产物（现在是 `removeArtifact` 只在 cancel 路径调用）。

### 5. `web/src/transcode/pipeline.ts` — 终止前先干净收尾

现在 `onRevoked` 直接 `terminateVideoWorker()`（`w.terminate()` 硬杀，`pipeline.ts:226-229`），被杀掉的 worker 无法 abort 它持有的 OPFS 流 —— 文件可能保持锁定，重试时 `createWritable()` 会失败。改为：

- 先 `postMessage({ t:'abortJob' })`，等 `{ t:'aborted' }`（有上限，约 2s），**再** terminate；
- `cancel(jobId)` 走同一条收尾路径；
- 转发新的 `videoResult` 形状（不再有 blob）。

### 6. 租约误回收（B）

页面在 `visibilitychange` 时向 SW 发 `leaseVisibility`；SW 在租约表上记 `hidden`，回收器**跳过 hidden 的租约**，但 `portLastSeen` 超过 `DEAD_OWNER_MS`（120s）仍然丢弃 —— "隐藏的页面不等于死掉的页面"，同时保留真正的死亡判定。`LEASE_TIMEOUT_MS = 15s` 对可见页面保持不变（崩溃恢复能力不变）。

## 新增的失败模式（必须显式处理）

流式化后产物在编码期间就存在于磁盘上，这是当前设计刻意避免的状态：

1. **取消 / 失败 / 租约回收** → 必须 `abort()` 并删除半成品，否则锁定的文件会让重试失败，残留文件也会占用配额。
2. **`readArtifact` / `resumePendingUploads` 不得把半成品当完整产物用**。现有防线仍然成立（`putPendingUpload` 只在成功后写、`afterStage1` 之后才有 pending 记录），但要确认没有新的读取路径提前读产物。
3. 视频 worker 被 terminate 时若来不及 abort，由 SW 侧的删除作为兜底。

## 验证

- `npm run lint` + `npm run ts-check` + `npm test`（复用 `web/tests/unit/pipeline.test.ts`、`lease.test.ts`、`protocol.test.ts`；为 `openArtifactSink` 的顺序哈希路径与 `nonSequential` 读回路径各加一条单测）。
- `npm run e2e -w infoto-web`（面板行/相位断言在 `pipeline.spec.ts`、`ui.spec.ts`）。全 pipeline 规格需要真实上传服务配置，做不到就明确说明，不谎报通过。
- 手工验证（需要浏览器）：上传一个较大的视频，观察面板行**单调推进、不再出现 sweep + 从 0 重来**；转码中切换标签页 ≥1 分钟再回来，确认**不再从头开始**；转码中取消，确认 OPFS 无残留（`navigator.storage.getDirectory()` 里 `infoto-artifacts/` 为空）。
- 内存验证：对大视频转码时观察该 worker 的内存峰值，确认不再等于产物大小。

## 文档

- 新增 ADR（`0014`）：产物 IO 的 owner 从 SharedWorker 扩展到页面侧的 video worker；视频结果消息不再携带 Blob；`hashing` 相位在视频路径上消失。说明这是用"编码期间存在半成品"换取"内存恒定 + 相位单调"的权衡，以及为什么不用 `AppendOnlyStreamTarget`。
- `.ai/memory/MEMORY.md` 的转码小节补上"产物写入必须在终止 worker 前干净 abort"这条坑。

## 不做什么

- 图片路径的物化不消除（无流式图片编码 API）。
- `transcodeGif` 把整个 GIF 读进内存（`file.arrayBuffer()`）属另一个话题，本轮不动。
