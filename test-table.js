import { renderMarkdown } from './src/utils/blogUtils.js';

// 测试表格渲染
const testMarkdown = `
| 姓名 | 年龄 | 城市 |
| ---- | :--- | ---- |
| 张三 | 25   | 北京 |
| 李四 | 30   | 上海 |
| 王五 | 28   | 广州 |
`;

console.log('渲染结果:');
console.log(renderMarkdown(testMarkdown));