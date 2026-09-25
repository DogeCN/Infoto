import type { JobMeta, JobPurpose, JobStatusMessage } from './shared/protocol';

export type PipelineResultAction = 'observe' | 'resolve' | 'reject' | 'ignore';

export function shouldDedupeArtifact(purpose: JobPurpose): boolean {
  return purpose === 'album';
}

export function shouldWriteAlbumUploadOp(
  purpose: JobPurpose,
  phase: JobStatusMessage['phase'],
  url: string | undefined,
  meta: JobMeta | undefined,
  alreadyWritten: boolean,
): boolean {
  return purpose === 'album' && phase === 'done' && !!url && !!meta && !alreadyWritten;
}

export function pipelineResultAction(
  message: Extract<JobStatusMessage, { t: 'jobStatus' }>,
  hasEditorWaiter: boolean,
): PipelineResultAction {
  if (message.purpose !== 'editor') return 'observe';
  if (message.phase !== 'done' && message.phase !== 'failed') return 'observe';
  if (!hasEditorWaiter) return 'ignore';
  return message.phase === 'done' && !!message.url ? 'resolve' : 'reject';
}
