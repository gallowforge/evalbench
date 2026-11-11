import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked } from 'marked';
import { Fragment, useMemo } from 'react';
import { fields } from '../lib/answer';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('yaml', yaml);

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Images in model output would load from wherever the model points (a tracking beacon at
    // best); show them as plain links instead.
    image({ href, text }) {
      return `<a href="${escape(href ?? '')}" rel="noreferrer noopener" target="_blank">[image: ${escape(text || href || '')}]</a>`;
    },
    code({ text, lang }) {
      const language = (lang || '').split(/\s/)[0];
      const html = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : escape(text);
      // Focusable, so a long line can be scrolled from the keyboard too.
      return `<pre tabindex="0"><code class="hljs">${html}</code></pre>`;
    },
  },
});

// Answers are untrusted: no styles, forms, frames or media that could restyle the page,
// cover the rating controls or call out.
const SANITIZE = {
  FORBID_TAGS: [
    'style',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'option',
    'iframe',
    'object',
    'embed',
    'img',
    'video',
    'audio',
    'source',
    'picture',
    'svg',
    'math',
    'link',
    'meta',
    'base',
  ],
  FORBID_ATTR: ['style', 'id', 'srcset', 'action', 'formaction'],
};

// Classes are kept only for syntax highlighting, so an answer cannot borrow the app's own layout
// classes (a full-screen overlay, say) to cover the page.
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'class' && !/^(hljs[\w-]*\s*)+$/.test(data.attrValue)) data.keepAttr = false;
});

/** Model output rendered as Markdown, sanitised. */
export function Markdown({ text, className = 'prose-answer' }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text ?? '', { async: false }) as string, SANITIZE), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * An answer as a reader wants it. A model that was asked for one JSON object answers in fields,
 * so those are set out as fields; everything else is Markdown. The text as sent is one click away
 * wherever the raw view is offered.
 */
export function Answer({ text }: { text: string }) {
  const parts = useMemo(() => fields(text), [text]);
  if (!parts) return <Markdown text={text} />;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5">
      {parts.map(([key, value]) => (
        <Fragment key={key}>
          {/* Wide enough for a name such as population_millions; a longer one is cut, and its title holds the rest. */}
          <dt className="max-w-[24ch] truncate pt-[4px] font-mono text-[12px] text-muted" title={key}>
            {key}
          </dt>
          <dd className="min-w-0 text-[15px] leading-[1.68] [overflow-wrap:anywhere] text-ink-2">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function Raw({ text }: { text: string }) {
  return <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-ink-2">{text}</pre>;
}
