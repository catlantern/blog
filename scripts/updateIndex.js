import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 定义文章目录和索引文件路径
const articlesDir = path.join(__dirname, '../public/articles');
const indexFile = path.join(articlesDir, 'index.json');

// 读取文章目录中的所有.md文件
fs.readdir(articlesDir, (err, files) => {
  if (err) {
    console.error('Error reading articles directory:', err);
    process.exit(1);
  }

  // 过滤出.md文件并排除index.json
  const mdFiles = files.filter(file => file.endsWith('.md') && file !== 'index.json');

  // 创建文章信息数组
  const articles = mdFiles.map(file => {
    const slug = path.basename(file, '.md');
    const filePath = path.join(articlesDir, file);
    
    // 读取文件内容
    const content = fs.readFileSync(filePath, 'utf8');
    
    // 提取标题（第一行的#标题）
    const titleMatch = content.match(/^#\s+(.*)$/m);
    const title = titleMatch ? titleMatch[1].trim() : `Article ${slug}`;
    
    // 提取标签和日期（这里可以根据需要自定义规则）
    // 使用正则表达式查找标签和日期
    let tag = 'uncategorized';
    let date = new Date().toISOString().split('T')[0];
    
    // 查找标签格式: tag: value
    const tagMatch = content.match(/tag:\s*(.*)/i);
    if (tagMatch) {
      tag = tagMatch[1].trim();
    }
    
    // 查找日期格式: date: value
    const dateMatch = content.match(/date:\s*(.*)/i);
    if (dateMatch) {
      date = dateMatch[1].trim();
    }
    
    return {
      slug,
      title,
      tag,
      date
    };
  });

  // 将文章信息写入index.json
  fs.writeFile(indexFile, JSON.stringify(articles, null, 2), (err) => {
    if (err) {
      console.error('Error writing index.json:', err);
      process.exit(1);
    }
    
    console.log('Successfully updated index.json with', articles.length, 'articles');
  });
});