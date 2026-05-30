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
        const highlightedCode = hljs.highlight(normalizedStr, { language: lang }).value;
        const lines = normalizedStr.split('\n');
        const lineNumbers = lines.map((_, index) => `<span class="line-number">${index + 1}</span>`).join('');
        
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

md.use(markdownItTable);
md.use(markdownItTaskLists);
md.use(markdownItFootnote);
md.use(markdownItKatex);

let articlesCache = null;

export const getArticleList = async () => {
  if (articlesCache) {
    return articlesCache;
  }
  try {
    const res = await fetch('/blog/articles/index.json');
    articlesCache = await res.json();
    return articlesCache.map(article => ({
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

export const renderMarkdown = (markdown) => {
  return md.render(markdown);
}

export const extractHeadings = (markdown) => {
  const headings = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  
  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text.toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    headings.push({
      level,
      text,
      id: `heading-${id}-${headings.length}`
    });
  }
  
  return headings;
}

export const getAdjacentArticles = async (currentSlug) => {
  const articles = await getArticleList();
  const currentIndex = articles.findIndex(article => article.slug === currentSlug);
  
  return {
    prev: currentIndex > 0 ? articles[currentIndex - 1] : null,
    next: currentIndex < articles.length - 1 ? articles[currentIndex + 1] : null
  };
}

export const getArticlesByTag = async (tag) => {
  const articles = await getArticleList();
  return articles.filter(article => article.tag === tag);
}

export const getAllTags = async () => {
  const articles = await getArticleList();
  const tags = [...new Set(articles.map(article => article.tag).filter(Boolean))];
  return tags;
}

export const getTagStats = async () => {
  const articles = await getArticleList();
  const tagMap = {};
  
  articles.forEach(article => {
    if (article.tag) {
      if (!tagMap[article.tag]) {
        tagMap[article.tag] = 0;
      }
      tagMap[article.tag]++;
    }
  });
  
  return Object.entries(tagMap).map(([name, count]) => ({ name, count }));
}

export const getCurrentArticleInfo = async (slug) => {
  const articles = await getArticleList();
  return articles.find(article => article.slug === slug);
}

export const addArticleToIndex = async (articleData) => {
  try {
    const articles = await getArticleList();
    articles.push({
      slug: articleData.slug,
      title: articleData.title,
      tag: articleData.tag,
      excerpt: articleData.excerpt,
      date: articleData.date || new Date().toISOString().split('T')[0]
    });
    
    articlesCache = null;
    return { success: true, message: '文章索引已更新' };
  } catch (error) {
    console.error('Error adding article:', error);
    return { success: false, message: '添加文章失败' };
  }
}

export const generateSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}
