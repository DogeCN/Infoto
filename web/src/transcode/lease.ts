// Token lease client: heartbeat every 5s while held; every page-side release path is
// enumerated here — complete / fail / worker onerror / pagehide.

import type { LeaseGrantedMessage, LeaseRevokedMessage, SwToPageMessage } from './protocol';
import { LEASE_HEARTBEAT_MS } from './protocol';

export interface LeasePort {
  postMessage: (m: unknown) => void;
}

export interface LeaseHandlers {
  onGranted: (m: LeaseGrantedMessage) => void;
  onRevoked: (m: LeaseRevokedMessage) => void;
}

/**
 * Video token lifecycle: acquire = onGranted; release = complete / fail / onerror / pagehide; heartbeat stops with the lease; after onRevoked none remains.
 */
export class LeaseClient {
  private leaseId: string | null = null;
  private jobId: string | null = null;
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
      this.leaseId = m.leaseId;
      this.jobId = m.jobId;
      this.startHeartbeat();
      this.handlers.onGranted(m);
    } else if (m.t === 'leaseRevoked') {
      this.stopHeartbeat();
      if (this.leaseId === m.leaseId) {
        this.leaseId = null;
        this.jobId = null;
      }
      this.handlers.onRevoked(m);
    }
  }

  /** Page-initiated release (complete / fail / worker onerror). */
  release(): void {
    this.stopHeartbeat();
    if (this.leaseId) {
      this.port.postMessage({ t: 'leaseRelease', leaseId: this.leaseId } satisfies {
        t: 'leaseRelease';
        leaseId: string;
      });
      this.leaseId = null;
      this.jobId = null;
    }
  }

  get heldJobId(): string | null {
    return this.jobId;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const id = this.leaseId;
    if (!id) return;
    this.timer = setInterval(() => {
      this.port.postMessage({ t: 'leaseHeartbeat', leaseId: id });
    }, LEASE_HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Register the global safety net: a hidden page has not unloaded (its video worker still encodes), so pagehide — not visibilitychange — releases the token when the page goes away.
   */
  install(scope: { addEventListener: Window['addEventListener'] } = window): void {
    if (this.installed) return;
    this.installed = true;
    scope.addEventListener('pagehide', () => this.release());
  }
}
