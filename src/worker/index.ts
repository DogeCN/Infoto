// Worker entry: maps the D1 and ASSETS bindings onto the app environment and caches
// one Hono app per isolate.

import { createApp, type AppEnv } from './app.ts';
import { d1Db } from './db-d1.ts';
import {
  MAX_OUTPUT_TOKENS,
  responseText,
  restTranslationRunner,
  structuredTranslator,
  TRANSLATION_MODEL,
  type ModelRunner,
} from './translate.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: Ai;
  /** Dev-only REST transport; production uses the AI binding instead. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  MEDIA_HOST_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
}

const apps = new WeakMap<Env, ReturnType<typeof createApp>>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let app = apps.get(env);
    if (!app) {
      // Workers AI is optional: a deployment without the binding still serves the album, and
      // the admin translate endpoint answers 503 instead of guessing.
      const ai = env.AI;
      // Local dev can opt into the REST transport from `.dev.vars`; production has neither
      // variable and therefore falls through to the Workers AI binding.
      const restRunner: ModelRunner | undefined =
        env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN
          ? restTranslationRunner(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN)
          : undefined;
      const bindingRunner: ModelRunner | undefined = ai
        ? async (messages, schema) => {
            const result = await ai.run(TRANSLATION_MODEL, {
              messages,
              response_format: { type: 'json_schema', json_schema: schema },
              temperature: 0,
              max_tokens: MAX_OUTPUT_TOKENS,
            });
            return responseText(result);
          }
        : undefined;
      const runner = restRunner ?? bindingRunner;
      const appEnv: AppEnv = {
        db: d1Db(env.DB),
        mediaHostUrl: env.MEDIA_HOST_URL,
        turnstileSecret: env.TURNSTILE_SECRET_KEY,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
        assets: (req) => env.ASSETS.fetch(req),
        translate: runner ? structuredTranslator(runner) : undefined,
      };
      app = createApp(appEnv);
      apps.set(env, app);
    }
    return app.fetch(request);
  },
};
