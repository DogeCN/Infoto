// The upload facade address, fanned out to every surface that owns an upload pipeline.
//
// One media host is configured for the whole page, but more than one pipeline can exist: the
// gallery and the admin page each build their own, and either can be the only one mounted
// (the admin announcement editor uploads without a gallery). A single slot made the last
// registrant own the address and left every other pipeline without it, so the editor's
// uploads failed with "no upload address configured" while the gallery's worked on the same
// page load.
//
// It is a module of its own (not a field on the app store) because both the layered store
// and the route components need it, and neither may import the other's pipeline.

/** Every registered sink. */
const sinks = new Set<(url: string) => void>();

/** The latest address, replayed to a sink that registers after the sync arrived. A surface
 *  mounted by a direct navigation (a bare `/admin` load) registers late and must still get it. */
let latest = '';

/**
 * Register a facade sink. It is called immediately when an address is already known, and
 * again whenever the address changes. Returns the unregister function.
 */
export function onMediaHost(sink: (url: string) => void): () => void {
  sinks.add(sink);
  if (latest) sink(latest);
  return () => {
    sinks.delete(sink);
  };
}

/** Publish a new facade address to every registered sink. */
export function publishMediaHost(url: string): void {
  latest = url;
  for (const sink of sinks) sink(url);
}
