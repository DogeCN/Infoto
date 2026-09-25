// Video / GIF transcode DedicatedWorker (contract: WebCodecs exists only in Window and DedicatedWorker — the SharedWorker global has no Worker constructor, so video runs here).
// Video: Mediabunny conversion, VP9 quantizer 30 CQ → VP8 fallback 'high' (auto-downgrades when probing fails), Opus 128kbps, resolution / framerate / channels preserved.
// GIF: ImageDecoder frames → VideoSampleSource (drives VideoEncoder), no audio track; the audio-track probe decides type (0/1/2). postMessage carries no transfer list (Blob is not Transferable).

import {
  ALL_FORMATS,
  BufferTarget,
  Conversion,
  Input,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  BlobSource,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { OPUS_BITRATE, VP9_QUANTIZER, parseGifLsdSize } from '$base/upload/pipeline';
import type { MediaType } from '$shared/types';

interface VideoJobMessage {
  t: 'videoJob';
  jobId: string;
  file: Blob;
  mime: string;
  engine: 'video' | 'gif';
}

export interface VideoWorkerResult {
  jobId: string;
  blob: Blob;
  width: number;
  height: number;
  hasAudio: boolean;
  /** photos.type semantics. */
  type: MediaType;
}

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

async function transcodeVideo(jobId: string, file: Blob): Promise<VideoWorkerResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('no_video_track');
  const audioTrack = await input.getPrimaryAudioTrack();
  const hasAudio = audioTrack !== null;
  const width = videoTrack.codedWidth ?? videoTrack.displayWidth;
  const height = videoTrack.codedHeight ?? videoTrack.displayHeight;
  const { codec, quality } = await pickVideoCodec(width, height);

  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
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
    const fb = await pickVideoCodecFallback(width, height);
    conversion = await Conversion.init({
      input,
      output: new Output({ format: new WebMOutputFormat(), target: new BufferTarget() }),
      video: { codec: fb.codec, quality: fb.quality },
      ...(hasAudio ? { audio: { codec: 'opus' as const, bitrate: OPUS_BITRATE } } : {}),
    });
  }
  conversion.onProgress = (p) => progress(jobId, p);
  await conversion.execute();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error('empty_output');
  const blob = new Blob([buffer], { type: 'video/webm' });
  return {
    jobId,
    blob,
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    hasAudio,
    type: hasAudio ? 2 : 1,
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
async function transcodeGif(jobId: string, file: Blob): Promise<VideoWorkerResult> {
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
  const track = decoder.tracks.selectedTrack;
  const frameCount = (decoder as unknown as { frameCount: number }).frameCount;
  if (!track || frameCount === 0) throw new Error('gif_decode_failed');
  const probe = await decoder.decode({ frameIndex: 0 });
  const width = probe.image.displayWidth || header?.width || 0;
  const height = probe.image.displayHeight || header?.height || 0;
  probe.image.close();
  if (width <= 0 || height <= 0) throw new Error('gif_dimensions_unknown');
  const { codec, quality } = await pickVideoCodec(width, height);

  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new VideoSampleSource({ codec, quality });
  output.addVideoTrack(source);
  await output.start();
  for (let i = 0; i < frameCount; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    // GIF frame duration µs → s; 100ms default for broken frames
    const durationUs = image.duration ?? 100_000;
    const sample = new VideoSample(image, {
      timestamp: i * (durationUs / 1e6),
      duration: durationUs / 1e6,
    });
    await source.add(sample);
    sample.close();
    progress(jobId, (i + 1) / frameCount);
  }
  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error('empty_output');
  return {
    jobId,
    blob: new Blob([buffer], { type: 'video/webm' }),
    width,
    height,
    hasAudio: false,
    type: 1,
  };
}

self.onmessage = async (e: MessageEvent<VideoJobMessage>) => {
  const msg = e.data;
  if (msg.t !== 'videoJob') return;
  try {
    const result =
      msg.engine === 'gif'
        ? await transcodeGif(msg.jobId, msg.file)
        : await transcodeVideo(msg.jobId, msg.file);
    // structured clone, no transfer list (a Blob never goes into transfers)
    self.postMessage({ t: 'videoResult', ...result });
  } catch (err) {
    self.postMessage({
      t: 'videoFailed',
      jobId: msg.jobId,
      error: String((err as Error)?.message ?? err),
    });
  }
};
