/**
 * ===========================================================================
 * CALLING A SERVER ACTION FROM A SCRIPT, FOR REAL
 * ===========================================================================
 * Every guard in app/actions/** runs through `assertLeagueOwner`, which reads
 * the viewer out of `cookies()` — and `cookies()` reads Next's per-request
 * AsyncLocalStorage. Outside a request that store is empty, so a script that
 * imports an action and calls it gets a context error rather than a refusal,
 * and a test written on top of that measures nothing at all. (This repo has
 * shipped probes that measured nothing; that is why this file exists rather
 * than a set of assertions about `ownsLeague` in isolation.)
 *
 * So the harness installs a real request store with a real cookie jar, and the
 * action runs exactly as it does behind a POST: same `cookies()`, same
 * `currentViewer()`, same `revalidatePath`.
 *
 * The two shims are Node-runtime gaps rather than cheats:
 *   - `globalThis.AsyncLocalStorage` is installed by the Next/edge runtime and
 *     Next's async-local-storage module throws an invariant without it;
 *   - React 18's `cache()` exists only in the react-server build, and
 *     lib/auth.ts memoises the session read with it. An identity function is
 *     the correct stand-in for a script: no memoisation, so every call re-reads.
 * ===========================================================================
 */
import { AsyncLocalStorage } from 'async_hooks';

(globalThis as unknown as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const React = require('react');
if (typeof React.cache !== 'function') React.cache = (fn: unknown) => fn;

/* eslint-disable @typescript-eslint/no-var-requires */
const { requestAsyncStorage } = require('next/dist/client/components/request-async-storage.external.js');
const { staticGenerationAsyncStorage } = require('next/dist/client/components/static-generation-async-storage.external.js');
const { RequestCookies } = require('next/dist/server/web/spec-extension/cookies.js');
const { HeadersAdapter } = require('next/dist/server/web/spec-extension/adapters/headers.js');
const { RequestCookiesAdapter } = require('next/dist/server/web/spec-extension/adapters/request-cookies.js');
/* eslint-enable @typescript-eslint/no-var-requires */

/** Run `fn` as though a browser carrying `cookie` had POSTed to a Server Action. */
export function asViewer<T>(cookie: string, fn: () => Promise<T>): Promise<T> {
  const headers = new Headers({ cookie });
  const jar = new RequestCookies(headers);
  const requestStore = {
    headers: HeadersAdapter.seal(headers),
    cookies: RequestCookiesAdapter.seal(jar),
    mutableCookies: jar,
    draftMode: { isEnabled: false },
    reactLoadableManifest: {},
    assetPrefix: '',
  };
  const staticStore = {
    isStaticGeneration: false,
    pagePath: '/probe',
    urlPathname: '/probe',
    // revalidatePath refuses without one; it only ever calls revalidateTag.
    incrementalCache: { revalidateTag: async () => {}, prerenderManifest: { preview: {} } },
    isRevalidate: false,
    isUnstableNoStore: false,
    isDraftMode: false,
    forceDynamic: true,
    revalidate: 0,
    tags: [] as string[],
    pendingRevalidates: {},
  };
  return staticGenerationAsyncStorage.run(staticStore, () => requestAsyncStorage.run(requestStore, fn));
}
