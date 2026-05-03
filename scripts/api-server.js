import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const articlesDir = path.join(__dirname, '..', 'public', 'articles');
const indexPath = path.join(articlesDir, 'index.json');

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.avif'
]);

function imageToBase64(imagePath) {
  if (!fs.existsSync(imagePath)) {
    return null;
  }
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.avif': 'image/avif'
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  return `data:${mime};base64,${base64}`;
}

function processMarkdownContent(content, mdDir) {
  let processed = content;

  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  processed = processed.replace(imageRegex, (match, altText, imagePath) => {
    if (imagePath.startsWith('data:') || imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return match;
    }

    let resolvedPath;
    if (path.isAbsolute(imagePath)) {
      resolvedPath = imagePath;
    } else {
      resolvedPath = path.resolve(mdDir, imagePath);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const base64 = imageToBase64(resolvedPath);
      if (base64) {
        console.log(`  图片转base64: ${imagePath} -> base64 (${Math.round(base64.length / 1024)}KB)`);
        return `![${altText}](${base64})`;
      } else {
        console.log(`  图片未找到: ${resolvedPath}`);
        return match;
      }
    }

    return match;
  });

  const fileLinkRegex = /\[([^\]]+)\]\(file:\/\/\/?[^)]+\)/g;
  processed = processed.replace(fileLinkRegex, (match, linkText) => {
    console.log(`  文件链接转换: ${match} -> **\`${linkText}\`**`);
    return `**\`${linkText}\`**`;
  });

  const anchorLinkRegex = /\[([^\]]+)\]\(#[^)]+\)/g;
  processed = processed.replace(anchorLinkRegex, (match, linkText) => {
    console.log(`  锚点链接转换: ${match} -> **\`${linkText}\`**`);
    return `**\`${linkText}\`**`;
  });

  return processed;
}

app.post('/api/import-markdown', (req, res) => {
  try {
    const { mdFilePath } = req.body;

    if (!mdFilePath) {
      return res.status(400).json({
        success: false,
        error: '缺少 mdFilePath 字段'
      });
    }

    const resolvedPath = path.resolve(mdFilePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: `文件不存在: ${resolvedPath}`
      });
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const mdDir = path.dirname(resolvedPath);

    console.log(`导入Markdown文件: ${resolvedPath}`);
    console.log(`基于目录: ${mdDir}`);

    const processed = processMarkdownContent(content, mdDir);

    const titleMatch = content.match(/^#\s+(.+)$/m);
    const autoTitle = titleMatch ? titleMatch[1].trim() : '';
    const autoSlug = path.basename(resolvedPath, '.md');
    const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    const autoExcerpt = lines.length > 0 ? lines.slice(0, 2).join(' ').substring(0, 100) : '';

    res.json({
      success: true,
      content: processed,
      meta: {
        title: autoTitle,
        slug: autoSlug,
        excerpt: autoExcerpt,
        fileName: path.basename(resolvedPath)
      }
    });
  } catch (error) {
    console.error('导入Markdown失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/articles', (req, res) => {
  try {
    const { slug, title, tag, excerpt, date, content } = req.body;
    
    if (!slug || !title || !tag || !excerpt || !content) {
      return res.status(400).json({ 
        success: false, 
        error: '缺少必要字段' 
      });
    }
    
    const mdFileName = `${slug}.md`;
    const mdFilePath = path.join(articlesDir, mdFileName);
    
    fs.writeFileSync(mdFilePath, content, 'utf-8');
    console.log(`已保存文件: ${mdFilePath}`);
    
    let indexData = [];
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      indexData = JSON.parse(indexContent);
    }
    
    const newEntry = { slug, title, tag, excerpt, date: date || new Date().toISOString().split('T')[0] };
    const existingIndex = indexData.findIndex(item => item.slug === slug);
    
    if (existingIndex !== -1) {
      indexData[existingIndex] = newEntry;
      console.log(`已更新文章索引: ${slug}`);
    } else {
      indexData.push(newEntry);
      console.log(`已添加文章索引: ${slug}`);
    }
    
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 4), 'utf-8');
    console.log(`已更新索引文件: ${indexPath}`);
    
    res.json({ 
      success: true, 
      message: '文章保存成功',
      file: mdFilePath,
      index: indexPath
    });
  } catch (error) {
    console.error('保存文章失败:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/articles', (req, res) => {
  try {
    if (!fs.existsSync(indexPath)) {
      return res.json([]);
    }
    
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    const articles = JSON.parse(indexContent);
    res.json(articles);
  } catch (error) {
    console.error('读取文章列表失败:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.delete('/api/articles/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    
    const mdFilePath = path.join(articlesDir, `${slug}.md`);
    
    if (fs.existsSync(mdFilePath)) {
      fs.unlinkSync(mdFilePath);
      console.log(`已删除文件: ${mdFilePath}`);
    }
    
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      let indexData = JSON.parse(indexContent);
      
      indexData = indexData.filter(item => item.slug !== slug);
      
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 4), 'utf-8');
      console.log(`已从索引中移除: ${slug}`);
    }
    
    res.json({ 
      success: true, 
      message: '文章删除成功' 
    });
  } catch (error) {
    console.error('删除文章失败:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/tags', (req, res) => {
  try {
    if (!fs.existsSync(indexPath)) {
      return res.json([]);
    }
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    const articles = JSON.parse(indexContent);
    const tagMap = {};
    articles.forEach(article => {
      if (article.tag) {
        tagMap[article.tag] = (tagMap[article.tag] || 0) + 1;
      }
    });
    const tags = Object.entries(tagMap).map(([name, count]) => ({ name, count }));
    res.json(tags);
  } catch (error) {
    console.error('读取标签失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/tags/:name', (req, res) => {
  try {
    const tagName = decodeURIComponent(req.params.name);
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ success: false, error: '索引文件不存在' });
    }
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    let indexData = JSON.parse(indexContent);
    const targetArticles = indexData.filter(item => item.tag === tagName);
    if (targetArticles.length === 0) {
      return res.status(404).json({ success: false, error: `标签 "${tagName}" 不存在` });
    }
    for (const article of targetArticles) {
      const mdFilePath = path.join(articlesDir, `${article.slug}.md`);
      if (fs.existsSync(mdFilePath)) {
        fs.unlinkSync(mdFilePath);
        console.log(`已删除文件: ${mdFilePath}`);
      }
    }
    indexData = indexData.filter(item => item.tag !== tagName);
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 4), 'utf-8');
    console.log(`已删除标签 "${tagName}" 及其 ${targetArticles.length} 篇文章`);
    res.json({ success: true, message: `已删除标签 "${tagName}" 及其 ${targetArticles.length} 篇文章`, deletedCount: targetArticles.length });
  } catch (error) {
    console.error('删除标签失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/tags/:name', (req, res) => {
  try {
    const oldName = decodeURIComponent(req.params.name);
    const { newName } = req.body;
    if (!newName) {
      return res.status(400).json({ success: false, error: '缺少 newName 字段' });
    }
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ success: false, error: '索引文件不存在' });
    }
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    let indexData = JSON.parse(indexContent);
    let count = 0;
    indexData = indexData.map(item => {
      if (item.tag === oldName) {
        item.tag = newName;
        count++;
      }
      return item;
    });
    if (count === 0) {
      return res.status(404).json({ success: false, error: `标签 "${oldName}" 不存在` });
    }
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 4), 'utf-8');
    console.log(`已将标签 "${oldName}" 重命名为 "${newName}"，影响 ${count} 篇文章`);
    res.json({ success: true, message: `已将标签 "${oldName}" 重命名为 "${newName}"，影响 ${count} 篇文章`, affectedCount: count });
  } catch (error) {
    console.error('重命名标签失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/articles/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const { title, tag, excerpt, date } = req.body;
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ success: false, error: '索引文件不存在' });
    }
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    let indexData = JSON.parse(indexContent);
    const idx = indexData.findIndex(item => item.slug === slug);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `文章 "${slug}" 不存在` });
    }
    if (title !== undefined) indexData[idx].title = title;
    if (tag !== undefined) indexData[idx].tag = tag;
    if (excerpt !== undefined) indexData[idx].excerpt = excerpt;
    if (date !== undefined) indexData[idx].date = date;
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 4), 'utf-8');
    console.log(`已更新文章元信息: ${slug}`);
    res.json({ success: true, message: '文章元信息已更新', article: indexData[idx] });
  } catch (error) {
    console.error('更新文章元信息失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/articles/batch-delete', (req, res) => {
  try {
    const { slugs } = req.body;
    if (!Array.isArray(slugs) || slugs.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 slugs 数组' });
    }
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ success: false, error: '索引文件不存在' });
    }
    let deletedCount = 0;
    for (const slug of slugs) {
      const mdFilePath = path.join(articlesDir, `${slug}.md`);
      if (fs.existsSync(mdFilePath)) {
        fs.unlinkSync(mdFilePath);
        console.log(`已删除文件: ${mdFilePath}`);
      }
      deletedCount++;
    }
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    let indexData = JSON.parse(indexContent);
    const slugSet = new Set(slugs);
    indexData = indexData.filter(item => !slugSet.has(item.slug));
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 4), 'utf-8');
    console.log(`批量删除 ${deletedCount} 篇文章`);
    res.json({ success: true, message: `已批量删除 ${deletedCount} 篇文章`, deletedCount });
  } catch (error) {
    console.error('批量删除文章失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tags/batch-delete', (req, res) => {
  try {
    const { names } = req.body;
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 names 数组' });
    }
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ success: false, error: '索引文件不存在' });
    }
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    let indexData = JSON.parse(indexContent);
    const nameSet = new Set(names);
    const targetArticles = indexData.filter(item => nameSet.has(item.tag));
    for (const article of targetArticles) {
      const mdFilePath = path.join(articlesDir, `${article.slug}.md`);
      if (fs.existsSync(mdFilePath)) {
        fs.unlinkSync(mdFilePath);
        console.log(`已删除文件: ${mdFilePath}`);
      }
    }
    indexData = indexData.filter(item => !nameSet.has(item.tag));
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 4), 'utf-8');
    console.log(`批量删除 ${names.length} 个标签及其 ${targetArticles.length} 篇文章`);
    res.json({ success: true, message: `已删除 ${names.length} 个标签及其 ${targetArticles.length} 篇文章`, deletedArticleCount: targetArticles.length, deletedTagCount: names.length });
  } catch (error) {
    console.error('批量删除标签失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n博客管理API服务器已启动!`);
  console.log(`API地址: http://localhost:${PORT}`);
  console.log(`\n可用接口:`);
  console.log(`  POST   /api/import-markdown  - 导入MD文件(自动处理图片+链接)`);
  console.log(`  POST   /api/articles         - 添加/更新文章`);
  console.log(`  GET    /api/articles         - 获取文章列表`);
  console.log(`  DELETE /api/articles/:slug   - 删除文章`);
  console.log(`  GET    /api/tags             - 获取标签列表`);
  console.log(`  DELETE /api/tags/:name       - 删除标签及其文章`);
  console.log(`  PUT    /api/tags/:name       - 重命名标签`);
  console.log(`\n按 Ctrl+C 停止服务器\n`);
});
