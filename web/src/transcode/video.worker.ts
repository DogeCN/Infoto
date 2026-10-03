// Video / GIF transcode DedicatedWorker — WebCodecs exists only in Window and DedicatedWorker, and the SharedWorker global has no Worker constructor, so video runs here.
// Video: Mediabunny conversion, VP9 quantizer 30 CQ → VP8 fallback 'high' (auto-downgrades when probing fails), Opus 128kbps, resolution / framerate / channels preserved.
// GIF: ImageDecoder frames → VideoSampleSource (drives VideoEncoder), no audio track; the audio-track probe decides type (0/1/2).
// The encoder writes straight into its OPFS artifact through `openArtifactSink`, which hashes the
// same chunks, so the encoded file is never held in memory and the result message carries a digest
// instead of a Blob.

import {
  ALL_FORMATS,
  Conversion,
  Input,
  Output,
  Quality,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  BlobSource,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { OPUS_BITRATE, VP9_QUANTIZER, parseGifLsdSize } from '$base/upload/pipeline';
import { openArtifactSink, removeArtifact, type ArtifactSink } from './opfs';

interface VideoJobMessage {
  t: 'videoJob';
  jobId: string;
  file: Blob;
  mime: string;
  engine: 'video' | 'gif';
}

/** Released the artifact handle, so the page can terminate this worker without leaving the
 *  partial file locked. */
interface VideoAbortMessage {
  t: 'abortJob';
}

type VideoInboundMessage = VideoJobMessage | VideoAbortMessage;

export interface VideoWorkerResult {
  jobId: string;
  /** Digest of the artifact this worker wrote to OPFS. */
  sha256: string;
  /** Artifact size in bytes. */
  bytes: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** The sink the running job writes through. A ref, because the VP8 fallback discards the
 *  first (still empty) sink and opens a fresh one. */
interface SinkRef {
  current: ArtifactSink;
}

let activeSink: SinkRef | null = null;

function progress(jobId: string, fraction: number): void {
  self.postMessage({ t: 'videoProgress', jobId, fraction });
}

/** VP9 (quantizer 30 constant quality) → VP8 (quality 'high') probe table.
 * quality must be a mediabunny `Quality` instance — plain objects throw. */
async function pickVideoCodec(
  width: number,
  height: number,
): Promise<{ codec: 'vp9' | 'vp8'; quality: Quality }> {
  const vp9 = await getFirstEncodableVideoCodec(['vp9'], {
    width,
    height,
    quality: new Quality({ quantizer: VP9_QUANTIZER }),
  });
  if (vp9 === 'vp9') return { codec: 'vp9', quality: new Quality({ quantizer: VP9_QUANTIZER }) };
  const vp8 = await getFirstEncodableVideoCodec(['vp8'], { width, height });
  if (vp8 === 'vp8') return { codec: 'vp8', quality: new Quality({ quality: 'high' }) };
  throw new Error('no_supported_video_codec');
}

/** Encode into the job's artifact; the caller reports the digest once the sink is finished. */
async function transcodeVideo(
  jobId: string,
  file: Blob,
  sink: SinkRef,
): Promise<{ width: number; height: number; hasAudio: boolean }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('no_video_track');
  const audioTrack = await input.getPrimaryAudioTrack();
  const hasAudio = audioTrack !== null;
  const width = videoTrack.codedWidth ?? videoTrack.displayWidth;
  const height = videoTrack.codedHeight ?? videoTrack.displayHeight;
  const { codec, quality } = await pickVideoCodec(width, height);

  let output = new Output({
    format: new WebMOutputFormat(),
    target: new StreamTarget(sink.current.writable),
  });
  let conversion: Conversion;
  try {
    conversion = await Conversion.init({
      input,
      output,
      video: { codec, quality },
      ...(hasAudio ? { audio: { codec: 'opus' as const, bitrate: OPUS_BITRATE } } : {}),
    });
  } catch (e) {
    // edge cases where the quantizer probe passed but the real encoder rejects: retry once with the VP8 fallback
    if (codec !== 'vp9') throw e;
    // The rejection happened before any frame was encoded, so the sink holds nothing: drop it
    // and open a fresh one rather than reusing a writable the failed output already bound.
    await sink.current.abort();
    sink.current = await openArtifactSink(jobId, 'webm');
    const fb = await pickVideoCodecFallback(width, height);
    const fallbackInput = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    output = new Output({
      format: new WebMOutputFormat(),
      target: new StreamTarget(sink.current.writable),
    });
    conversion = await Conversion.init({
      input: fallbackInput,
      output,
      video: { codec: fb.codec, quality: fb.quality },
      ...(hasAudio ? { audio: { codec: 'opus' as const, bitrate: OPUS_BITRATE } } : {}),
    });
  }
  conversion.onProgress = (p) => progress(jobId, p);
  await conversion.execute();
  return {
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    hasAudio,
  };
}

async function pickVideoCodecFallback(
  width: number,
  height: number,
): Promise<{ codec: 'vp8'; quality: Quality }> {
  const vp8 = await getFirstEncodableVideoCodec(['vp8'], { width, height });
  if (vp8 !== 'vp8') throw new Error('no_supported_video_codec');
  return { codec: 'vp8', quality: new Quality({ quality: 'high' }) };
}

/** GIF: ImageDecoder frame-by-frame → VideoSampleSource (internal VideoEncoder). */
async function transcodeGif(
  jobId: string,
  file: Blob,
  sink: SinkRef,
): Promise<{ width: number; height: number; hasAudio: boolean }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // ImageDecoder's GIF track does not report codedWidth/codedHeight on some
  // Chromium builds — fall back to reading the GIF header LSD size (base pipeline pure function).
  const header = parseGifLsdSize(buf);
  let decoder: ImageDecoder;
  try {
    decoder = new ImageDecoder({ data: buf, type: 'image/gif' });
    await decoder.tracks.ready;
    await decoder.completed;
  } catch {
    throw new Error('gif_decode_failed');
  }
  try {
    const track = decoder.tracks.selectedTrack;
    const frameCount = (decoder as unknown as { frameCount: number }).frameCount;
    if (!track || frameCount === 0) throw new Error('gif_decode_failed');
    const probe = await decoder.decode({ frameIndex: 0 });
    const width = probe.image.displayWidth || header?.width || 0;
    const height = probe.image.displayHeight || header?.height || 0;
    probe.image.close();
    if (width <= 0 || height <= 0) throw new Error('gif_dimensions_unknown');
    const { codec, quality } = await pickVideoCodec(width, height);

    const output = new Output({
      format: new WebMOutputFormat(),
      target: new StreamTarget(sink.current.writable),
    });
    const source = new VideoSampleSource({ codec, quality });
    output.addVideoTrack(source);
    await output.start();
    for (let i = 0; i < frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const durationUs = Math.max(image.duration ?? 100_000, 1000);
      const sample = new VideoSample(image, {
        timestamp: i * (durationUs / 1e6),
        duration: durationUs / 1e6,
      });
      await source.add(sample);
      sample.close();
      image.close();
      progress(jobId, (i + 1) / frameCount);
    }
    await output.finalize();
    return { width, height, hasAudio: false };
  } finally {
    decoder.close();
  }
}

/** Run one job through the sink, so the artifact reaches disk while it is still being encoded. */
async function runJob(msg: VideoJobMessage): Promise<VideoWorkerResult> {
  const sink: SinkRef = { current: await openArtifactSink(msg.jobId, 'webm') };
  activeSink = sink;
  try {
    const shape =
      msg.engine === 'gif'
        ? await transcodeGif(msg.jobId, msg.file, sink)
        : await transcodeVideo(msg.jobId, msg.file, sink);
    const { sha256, bytes } = await sink.current.finish();
    // With streaming writes there is no buffer to inspect: an encoder that produced nothing
    // leaves a zero-byte artifact behind.
    if (bytes === 0) {
      await removeArtifact(msg.jobId, 'webm');
      throw new Error('empty_output');
    }
    return { jobId: msg.jobId, sha256, bytes, ...shape };
  } catch (err) {
    await sink.current.abort();
    throw err;
  } finally {
    if (activeSink === sink) activeSink = null;
  }
}

self.onmessage = async (e: MessageEvent<VideoInboundMessage>) => {
  const msg = e.data;
  if (msg.t === 'abortJob') {
    // Release the artifact handle before the page terminates this worker: a worker killed
    // mid-write would otherwise leave the partial file locked.
    await activeSink?.current.abort();
    self.postMessage({ t: 'aborted' });
    self.close();
    return;
  }
  if (msg.t !== 'videoJob') return;
  try {
    self.postMessage({ t: 'videoResult', ...(await runJob(msg)) });
  } catch (err) {
    self.postMessage({
      t: 'videoFailed',
      jobId: msg.jobId,
      error: String((err as Error)?.message ?? err),
    });
  }
};
