import path from 'node:path';

/** Serve local seed artifacts through Vite's static-file and byte-range handling. */
export function seedMediaPlugin() {
  return {
    name: 'seed-media',
    apply: 'serve',
    configureServer(server) {
      if (process.env.INFOTO_SEED_MEDIA !== '1') return;
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, 'http://dev.invalid');
        if (!url.pathname.startsWith('/__seed-media/')) return next();
        const name = url.pathname.slice('/__seed-media/'.length);
        if (!/^[\w-]+\.(webp|webm)$/.test(name)) {
          response.writeHead(404).end();
          return;
        }
        request.url =
          '/@fs/' +
          path.resolve(import.meta.dirname, '../seed-media/transcoded', name).replaceAll('\\', '/');
        next();
      });
    },
  };
}
