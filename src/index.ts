import { page } from './html';

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const title = new Map([['/', 'Top'], ['/new', 'New'], ['/search', 'Search']]).get(pathname);
    if (!title) return page('Not found', '<h1>Page not found</h1>', 404);
    return page(title, `<h1>${title}</h1><p>The feed is being set up.</p>`);
  },
} satisfies ExportedHandler<Env>;
