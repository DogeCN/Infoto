// The SharedWorker shell for the sync coordinator. One instance per browser: it owns
// the single WebSocket (ADR 0026), the ack bookkeeping over the shared oplog, and
// fans every server frame out to every tab's engine.

import {
  attachCoordinatorPort,
  CoordinatorCore,
  type CoordinatorMessage,
  type TabMessage,
} from './coordinator';

interface TabPort {
  addEventListener: (type: 'message', l: (ev: { data: TabMessage }) => void) => void;
  postMessage: (message: CoordinatorMessage) => void;
  start?: () => void;
}

const core = new CoordinatorCore({
  onFrame: (frame) => broadcast({ kind: 'frame', frame }),
  onState: (state) => broadcast({ kind: 'state', ...state }),
  onDropped: (cid) => broadcast({ kind: 'dropped', cid }),
});

const ports: TabPort[] = [];

function broadcast(message: CoordinatorMessage): void {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      // A closing tab drops the message; the next frame re-syncs it.
    }
  }
}

// SharedWorkerGlobalScope: one onconnect per worker, one port per tab.
self.onconnect = (event: MessageEvent) => {
  const port = event.source as unknown as TabPort | null;
  if (!port) return;
  ports.push(port);
  attachCoordinatorPort(core, port);
};
