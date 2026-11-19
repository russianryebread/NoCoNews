import { refreshRanking } from './ranking';
import { participation } from './participation';
import { auth, currentMember, type AppEnv } from './auth';
import { InvalidForm } from './forms';
import { search } from './search';
import { page } from './html';
import { discussion, feed } from './stories';

export default {
  async scheduled(event, env) {
    await refreshRanking(env.DB, event.scheduledTime);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      const account = await auth(request, env, url);
      if (account) return account;
      const action = await participation(request, env.DB, url);
      if (action) return action;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      }

      if (pathname === '/' || pathname === '/new') return await feed(env.DB, url, await currentMember(request, env.DB));

      const story = /^\/stories\/(\d+)$/.exec(pathname);
      if (story && Number.isSafeInteger(Number(story[1]))) {
        return await discussion(env.DB, Number(story[1]), url.searchParams.get('comment'), await currentMember(request, env.DB));
      }

      if (pathname === '/search') return await search(env.DB, url);
      return page('Not found', '<h1>Page not found</h1>', 404);
    } catch (error) {
      if (error instanceof InvalidForm) return page('Invalid request', '<h1>Invalid request</h1>', 400);
      console.error({ event: 'page_query_failed' });
      return page('Unavailable', '<h1>Temporarily unavailable</h1>', 503);
    }
  },
} satisfies ExportedHandler<AppEnv>;
