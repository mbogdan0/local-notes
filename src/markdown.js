import { Marked } from 'marked';
import { escapeHtml } from './format.js';

// Markdown rendering for the reading view.
//
// marked stopped sanitizing in v5, and rendered output goes straight into
// innerHTML — including notes that arrived through Import from somebody else's
// file. Rather than add a sanitizer dependency, the two holes are closed at the
// source: raw HTML never survives parsing, and only safe URL schemes are
// emitted. That leaves nothing for a `<script>` or an `onerror=` to ride in on.

// Anything with no scheme (relative links, anchors) is fine; anything with one
// must be on this list. An allowlist, because a blocklist of `javascript:` and
// friends is exactly the kind of thing that gets bypassed.
const ALLOWED_SCHEMES = /^(https?|mailto|tel)$/i;

// Drop control characters, spaces and non-breaking space before the scheme is
// read. Without this, "java<TAB>script:alert(1)" sails past the allowlist,
// because the browser ignores those characters when it resolves the URL.
const stripUrlNoise = value => {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code <= 0x20 || (code >= 0x7f && code <= 0xa0)) continue;
    out += ch;
  }
  return out;
};

const safeUrl = href => {
  if (typeof href !== 'string') return null;
  const url = stripUrlNoise(href);
  if (!url) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!scheme) return url; // relative link or anchor
  return ALLOWED_SCHEMES.test(scheme[1]) ? url : null;
};

// breaks: true — these are notes, not documents. A single newline reading as a
// line break is what people actually mean when they hit Enter.
const marked = new Marked({ gfm: true, breaks: true });

marked.use({
  renderer: {
    // Raw HTML is shown as literal text instead of being executed.
    html({ text }) {
      return escapeHtml(String(text ?? ''));
    },

    link({ href, title, tokens }) {
      const body = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      // A rejected URL still shows its text — dropping the link silently would
      // make the note look like it had lost content.
      if (!url) return body;
      const attr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(url)}"${attr} target="_blank" rel="noopener noreferrer nofollow">${body}</a>`;
    },

    image({ href, title, text }) {
      const url = safeUrl(href);
      const alt = escapeHtml(String(text ?? ''));
      if (!url) return alt;
      const attr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(url)}" alt="${alt}"${attr} loading="lazy" />`;
    },
  },
});

export const renderMarkdown = source =>
  marked.parse(String(source ?? ''), { async: false });
