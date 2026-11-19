import { Marked } from 'marked';
import { escapeHtml } from './html';

const markdown = new Marked({
  gfm: false,
  breaks: true,
  renderer: {
    html: ({ raw }) => escapeHtml(raw),
    link: ({ raw }) => escapeHtml(raw),
    image: ({ raw }) => escapeHtml(raw),
    def: ({ raw }) => `<p>${escapeHtml(raw)}</p>\n`,
    heading({ tokens }) {
      return `<p><strong>${this.parser.parseInline(tokens)}</strong></p>\n`;
    },
    text(token) {
      return 'tokens' in token && token.tokens
        ? this.parser.parseInline(token.tokens)
        : escapeHtml(token.text);
    },
  },
});

export function renderMarkdown(text: string): string {
  return markdown.parse(text, { async: false });
}
