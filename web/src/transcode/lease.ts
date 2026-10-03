// Token lease client: heartbeat every 5s while held; every page-side release path is
// enumerated here — complete / fail / worker onerror / pagehide.

import {
  type LeaseGrantedMessage,
  type LeaseRevokedMessage,
  type SwToPageMessage,
  LEASE_HEARTBEAT_MS,
} from './protocol';

export interface LeasePort {
  postMessage: (m: unknown) => void;
}

export interface LeaseHandlers {
  onGranted: (m: LeaseGrantedMessage) => void;
  onRevoked: (m: LeaseRevokedMessage) => void;
}

/**
 * Video token lifecycle: acquire = onGranted; release = complete / fail / onerror / pagehide.
 *
 * A page holds every lease the video pool grants it, and the pool is sized at two or more, so
 * leases are tracked as a set. A single slot would let the newest grant stop the previous
 * lease's heartbeat: the SW then reads that silence as a dead page, revokes it after
 * `LEASE_TIMEOUT_MS`, and the encode restarts from zero — which the next grant repeats.
 */
export class LeaseClient {
  /** leaseId → jobId for every lease this page currently holds. */
  private held = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: LeaseHandlers;
  private installed = false;

  constructor(
    private port: LeasePort,
    handlers: LeaseHandlers,
  ) {
    this.handlers = handlers;
  }

  /** Hook into the SW message stream (the single page ⇄ SharedWorker channel). */
  handleMessage(m: SwToPageMessage): void {
    if (m.t === 'leaseGranted') {
      this.held.set(m.leaseId, m.jobId);
      this.startHeartbeat();
      // A job granted while the document is already hidden must say so up front: the SW
      // otherwise starts the lease as visible and reaps it on the first missed heartbeat.
      this.reportVisibility();
      this.handlers.onGranted(m);
    } else if (m.t === 'leaseRevoked') {
      // Drop only the revoked lease: every other held lease must keep its heartbeat.
      this.held.delete(m.leaseId);
      if (this.held.size === 0) this.stopHeartbeat();
      this.handlers.onRevoked(m);
    }
  }

  /** Page-initiated release. Without a jobId every held lease is returned (pagehide). */
  release(jobId?: string): void {
    for (const [leaseId, heldJob] of [...this.held]) {
      if (jobId !== undefined && heldJob !== jobId) continue;
      this.held.delete(leaseId);
      this.port.postMessage({ t: 'leaseRelease', leaseId } satisfies {
        t: 'leaseRelease';
        leaseId: string;
      });
    }
    if (this.held.size === 0) this.stopHeartbeat();
  }

  get heldJobId(): string | null {
    return this.held.values().next().value ?? null;
  }

  /** One timer covers every held lease, so a new grant cannot silence an older one. */
  private startHeartbeat(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      for (const leaseId of this.held.keys()) {
        this.port.postMessage({ t: 'leaseHeartbeat', leaseId });
      }
    }, LEASE_HEARTBEAT_MS);
  }

  /** Report the document's visibility for every held lease. The SW's reaper reads a missed
   *  heartbeat as death; a hidden page's heartbeat is throttled to about one tick a minute, so
   *  it needs to be excluded while the page keeps encoding. */
  private reportVisibility(): void {
    if (this.held.size === 0) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    for (const leaseId of this.held.keys()) {
      this.port.postMessage({ t: 'leaseVisibility', leaseId, hidden });
    }
  }

  private stopHeartbeat(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Register the global safety net: a hidden page has not unloaded (its video worker still encodes), so pagehide — not visibilitychange — releases the token when the page goes away. Visibility is only reported, never used to release.
   */
  install(scope: { addEventListener: Window['addEventListener'] } = window): void {
    if (this.installed) return;
    this.installed = true;
    scope.addEventListener('pagehide', () => this.release());
    // `visibilitychange` is fired at the document, so it is observed there. A listener on the
    // window would rely on bubbling the Page Visibility spec does not promise, and its silence
    // would leave the SW treating a throttled heartbeat as a dead page.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.reportVisibility());
    }
  }
}
