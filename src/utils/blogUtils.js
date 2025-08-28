import MarkdownIt from 'markdown-it';
import { markdownItTable } from 'markdown-it-table';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItKatex from 'markdown-it-katex';
import hljs from 'highlight.js';

const md = new MarkdownIt({
  highlight: function (str, lang) {
    const normalizedStr = str.endsWith('\n') ? str.slice(0, -1) : str;
    
    if (lang && hljs.getLanguage(lang)) {
      try {
        // 获取高亮后的代码
        const highlightedCode = hljs.highlight(normalizedStr, { language: lang }).value;
        
        // 生成行号
        const lines = normalizedStr.split('\n');
        const lineNumbers = lines.map((_, index) => `<span class="line-number">${index + 1}</span>`).join('');
        
        // 创建新的代码块结构
        return `<div class="code-block-wrapper">
                  <div class="code-header">
                    <span class="language-indicator">${lang}</span>
                    <span class="copy-button">复制</span>
                    <span class="full-scrren-button">全屏</span>
                  </div>
                  <div class="code-content">
                    <pre class="line-numbers">${lineNumbers}</pre>
                    <pre class="hljs code-container"><code>${highlightedCode}</code></pre>
                  </div>
                </div>`;
      } catch (__) {}
    }

    // 无语言指定的情况
    const lines = normalizedStr.split('\n');
    const lineNumbers = lines.map((_, index) => `<span class="line-number">${index + 1}</span>`).join('');
    
    return `<div class="code-block-wrapper">
              <div class="code-header">
                <span class="language-indicator">text</span>
                <span class="copy-button">复制</span>
                <span class="full-scrren-button">全屏</span>
              </div>
              <div class="code-content">
                <pre class="line-numbers">${lineNumbers}</pre>
                <pre class="hljs code-container"><code>${md.utils.escapeHtml(normalizedStr)}</code></pre>
              </div>
            </div>`;
  },
  html: true,
  xhtmlOut: true,
  breaks: true,
  linkify: true,
  typographer: true
});


// 启用表格插件
md.use(markdownItTable);

// 启用任务列表插件
md.use(markdownItTaskLists);

// 启用脚注插件
md.use(markdownItFootnote);

// 启用数学公式插件
md.use(markdownItKatex);
export const getArticleList = async () => {
  try {
    const res = await fetch('/blog/articles/index.json');
    const articles = await res.json();
    return articles.map(article => ({
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      tag: article.tag,
      date: article.date
    }));
  } catch (error) {
    console.error('Error fetching articles:', error);
    return [];
  }
}

// 根据slug获取文章内容
export const getArticleBySlug = async (slug) => {
  try {
    const res = await fetch(`/blog/articles/${slug}.md`);
    if (!res.ok) {
      throw new Error('Network response was not ok');
    }
    const markdownContent = await res.text();
    return markdownContent;
  } catch (error) {
    console.error('Error fetching article:', error);
    return null;
  }
}

// 渲染Markdown
export const renderMarkdown = (markdown) => {
  return md.render(markdown);
}