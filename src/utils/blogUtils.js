import MarkdownIt from 'markdown-it';
import { markdownItTable } from 'markdown-it-table';
import hljs from 'highlight.js';
// 移除默认样式导入，完全使用自定义样式

const md = new MarkdownIt({
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs"><code>' +
               hljs.highlight(str, { language: lang }).value +
               '</code></pre>';
      } catch (__) {}
    }

    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
  },
  html: true,
  xhtmlOut: true,
  breaks: true,
  linkify: true,
  typographer: true
});

// 启用表格插件
md.use(markdownItTable);

// 获取文章列表
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