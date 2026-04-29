import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  marked.use(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
    }) as Parameters<typeof marked.use>[0],
  );
  marked.setOptions({ gfm: true, breaks: false });
  initialized = true;
}

export interface RenderOptions {
  /**
   * If true (default), pre-extract ```mermaid blocks and replace them with
   * `<div class="mermaid" data-mermaid-index="N"></div>` placeholders.
   * The caller is then expected to fill the placeholders with the original
   * mermaid source after the HTML lands in the DOM, then call mermaid.render
   * on each. Set to false to leave mermaid blocks as plain code blocks.
   */
  extractMermaid?: boolean;
}

export interface RenderResult {
  html: string;
  /** Mermaid sources extracted from the markdown, indexed by `data-mermaid-index`. */
  mermaidBlocks: string[];
}

/**
 * Marked-and-sanitized HTML rendering of a markdown string.
 *
 * Same pipeline used by both the VSCode webview and the Electron renderer:
 *   marked + marked-highlight (highlight.js common languages)
 *   → DOMPurify sanitize
 *   → optional mermaid placeholder extraction.
 */
export function renderMarkdown(markdown: string, options: RenderOptions = {}): RenderResult {
  ensureInitialized();
  const { extractMermaid = true } = options;
  const mermaidBlocks: string[] = [];

  let source = markdown;
  if (extractMermaid) {
    source = source.replace(/```mermaid\s*\n([\s\S]*?)\n```/g, (_, code: string) => {
      const idx = mermaidBlocks.push(code) - 1;
      return `<div class="mermaid" data-mermaid-index="${idx}"></div>`;
    });
  }

  const rawHtml = marked.parse(source, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['mermaid'],
    ADD_ATTR: ['data-mermaid-index', 'data-mermaid-source', 'class', 'target'],
  });

  return { html: safeHtml, mermaidBlocks };
}

/**
 * Apply the extracted mermaid sources back to a freshly-mounted DOM.
 * Call after writing `result.html` into the page.
 */
export function applyMermaidPlaceholders(root: Element, mermaidBlocks: string[]): void {
  root.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-index]').forEach(el => {
    const idx = Number(el.getAttribute('data-mermaid-index'));
    if (!Number.isNaN(idx) && mermaidBlocks[idx] !== undefined) {
      el.textContent = mermaidBlocks[idx];
      el.removeAttribute('data-mermaid-index');
    }
  });
}
