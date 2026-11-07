// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown rendering of model output', () => {
  it('keeps code highlighting', () => {
    const html = render('```python\ndef f():\n    return 1\n```');
    expect(html).toContain('class="hljs-keyword"');
  });

  it('never loads remote images', () => {
    const html = render('![chart](http://tracker.example.com/p.png) <img src="http://tracker.example.com/q.png">');
    expect(html).not.toContain('<img');
    expect(html).toContain('[image: chart]');
  });

  it('drops scripts, styles, forms and borrowed layout classes', () => {
    const html = render(
      '<script>alert(1)</script><style>body{display:none}</style><form action="http://x"><input name="p"></form>' +
        '<div class="fixed inset-0 z-50" style="position:fixed">cover</div><a href="javascript:alert(1)">x</a>',
    );
    for (const bad of ['<script', '<style', '<form', '<input', 'fixed inset-0', 'position:fixed', 'javascript:']) {
      expect(html).not.toContain(bad);
    }
    expect(html).toContain('cover');
  });
});
