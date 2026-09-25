// SharedWorker global declarations. The host browser injects onconnect in the SharedWorker
// scope; kept in a .d.ts so sw.ts stays free of declare blocks that would interfere with
// module resolution. `declare var` (mutable global) lets sw.ts assign onconnect = ... .
declare var onconnect: ((e: MessageEvent) => void) | null;
