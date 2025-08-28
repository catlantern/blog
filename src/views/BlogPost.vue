<template>
  <div class="blog-post">
    <el-button @click="goBack" type="primary" round>
      返回首页
    </el-button>
    <el-card class="post-content">
      <div class="markdown-content" v-html="renderedMarkdown"></div>
    </el-card>
  </div>
</template>

<script>
import { ref, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getArticleBySlug, renderMarkdown } from '../utils/blogUtils'

export default {
  name: 'BlogPost',
  props: ['slug'],
  setup(props) {
    const route = useRoute()
    const router = useRouter()
    const renderedMarkdown = ref('')
    
    const goBack = () => {
      router.push('/')
    }
    
    // 复制代码功能
    const copyCode = (button) => {
      // 获取代码内容
      const codeBlock = button.closest('.code-block-wrapper')
      const codeContainer = codeBlock.querySelector('.code-container code')
      const codeText = codeContainer.innerText
      
      // 复制到剪贴板
      navigator.clipboard.writeText(codeText).then(() => {
        // 显示成功状态
        const originalText = button.innerText
        button.innerText = '已复制'
        button.classList.add('copied')
        
        // 2秒后恢复原始状态
        setTimeout(() => {
          button.innerText = originalText
          button.classList.remove('copied')
        }, 2000)
      }).catch(err => {
        console.error('复制失败:', err)
      })
    }
    
    // 全屏显示功能
    const toggleFullscreen = (button) => {
      const codeBlock = button.closest('.code-block-wrapper')
      
      if (!document.fullscreenElement) {
        // 进入全屏
        if (codeBlock.requestFullscreen) {
          codeBlock.requestFullscreen()
        } else if (codeBlock.webkitRequestFullscreen) {
          codeBlock.webkitRequestFullscreen()
        } else if (codeBlock.msRequestFullscreen) {
          codeBlock.msRequestFullscreen()
        }
        button.innerText = '退出全屏'
      } else {
        // 退出全屏
        if (document.exitFullscreen) {
          document.exitFullscreen()
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen()
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen()
        }
        button.innerText = '全屏'
      }
    }
    
    // 处理代码块按钮点击事件
    const handleCodeBlockEvents = () => {
      // 使用事件委托处理动态添加的元素
      document.addEventListener('click', (event) => {
        // 处理复制按钮点击
        if (event.target.classList.contains('copy-button')) {
          copyCode(event.target)
        }
        
        // 处理全屏按钮点击
        if (event.target.classList.contains('full-scrren-button')) {
          toggleFullscreen(event.target)
        }
      })
    }
    
    onMounted(async () => {
      try {
        const slug = props.slug || route.params.slug
        const markdownContent = await getArticleBySlug(slug)
        
        if (markdownContent) {
          renderedMarkdown.value = renderMarkdown(markdownContent)
          // 等待DOM更新后绑定事件
          nextTick(() => {
            handleCodeBlockEvents()
          })
        } else {
          renderedMarkdown.value = '<p>文章未找到</p>'
        }
      } catch (error) {
        console.error('Error loading blog post:', error)
        renderedMarkdown.value = '<p>文章加载失败</p>'
      }
    })
    
    return {
      renderedMarkdown,
      goBack
    }
  }
}
</script>

<style scoped>
.blog-post {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem; /* 控制按钮和卡片之间的间距 */
}

.blog-post ::v-deep(.el-button) {
  align-self: flex-start; /* 按钮左对齐 */
  margin: 0; /* 移除margin，使用gap控制间距 */
  transition: all 0.3s;
}

.blog-post ::v-deep(.el-button:hover) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
}

.post-content {
  border: none;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  max-width: 100%;
  width: 100%; /* 改为100%以适应容器 */
  flex: 1; /* 占据剩余空间 */
}

@media (max-width: 768px) {
  .blog-post {
    padding: 1rem;
    gap: 1rem; /* 响应式间距 */
  }
}

/* Markdown行内代码样式 */
.markdown-content :deep(code) {
  background-color: #f7c8c8;
  border-radius: 4px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85em;
}

/* Markdown代码块样式 */
.markdown-content :deep(.code-block-wrapper) {
  background-color: #f0f0f0;
  border-radius: 6px;
  margin: 1rem 0; /* 代码块上下间距 */
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.markdown-content :deep(.code-header) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.8em;
  display: flex;
  align-items: center;
  justify-content: space-between; /* 两端对齐 */
  margin: 0;
  padding: 6px 12px;
  color: #555;
  border-bottom: 1px solid #ddd;
  background-color: #e8e8e8;
  min-height: 0;
}

.markdown-content :deep(.language-indicator) {
  font-weight: 600;
  font-size: 0.8em;
  text-transform: uppercase;
  margin: 0;
  padding: 0;
  line-height: 1;
  letter-spacing: 0.5px;
}

/* 复制按钮样式 */
.markdown-content :deep(.copy-button) {
  cursor: pointer;
  padding: 2px 8px;
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  transition: all 0.3s;
  margin-left: auto; /* 推到右边 */
  margin-right: 8px; /* 与全屏按钮的间距 */
}

/* 全屏按钮样式 */
.markdown-content :deep(.full-scrren-button) {
  cursor: pointer;
  padding: 2px 8px;
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  transition: all 0.3s;
}

/* 按钮悬停效果 */
.markdown-content :deep(.copy-button:hover),
.markdown-content :deep(.full-scrren-button:hover) {
  background-color: #e0e0e0;
  transform: translateY(-1px);
}

/* 按钮激活状态 */
.markdown-content :deep(.copy-button.copied) {
  background-color: #4CAF50;
  color: white;
  border-color: #4CAF50;
}

.markdown-content :deep(.code-content) {
  display: flex;
  margin: 0;
  overflow-x: auto;
  flex: 1;
}

.markdown-content :deep(.line-numbers) {
  background-color: #e8e8e8;
  padding: 1rem 0.5rem;
  text-align: center;
  min-width: 10px;
  margin: 0;
  border-radius: 0;
  border: none;
  color: #777;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85em;
  line-height: 1.5;
  user-select: none;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.markdown-content :deep(.code-container) {
  background-color: #f8f8f8;
  margin: 0;
  padding: 1rem;
  border-radius: 0;
  flex: 1;
  overflow-x: auto;
  border: none;
  display: flex;
  flex-direction: column;
}

.markdown-content :deep(.code-container code) {
  background-color: transparent;
  color: inherit;
  padding: 0;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85em;
  line-height: 1.5;
  flex: 1;
}

/* 修复拼写错误 */
.markdown-content :deep(.code-content) {
  display: flex;
  margin: 0;
  overflow-x: auto;
}

/* Markdown引用块样式 */
.markdown-content :deep(blockquote) {
  margin: 1rem 0;
  padding: 1rem 1.5rem;
  border-left: 4px solid #409eff;
  background-color: #f5f7fa;
  color: #606266;
  font-style: italic;
  border-radius: 0 4px 4px 0;
}

.markdown-content :deep(blockquote p) {
  margin: 0.5rem 0;
  line-height: 1.6;
}

.markdown-content :deep(blockquote p:first-child) {
  margin-top: 0;
}

.markdown-content :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

/* 嵌套引用块样式 */
.markdown-content :deep(blockquote blockquote) {
  margin: 0.5rem 0;
  padding: 0.5rem 1rem;
  border-left: 3px solid #67c23a;
  background-color: #f0f9eb;
}

.markdown-content :deep(blockquote blockquote blockquote) {
  border-left: 2px solid #e6a23c;
  background-color: #fdf6ec;
}

/* 任务列表样式 */
.markdown-content :deep(.contains-task-list) {
  padding-left: 0;
  list-style: none;
}

.markdown-content :deep(.task-list-item) {
  display: flex;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.markdown-content :deep(.task-list-item input[type="checkbox"]) {
  margin-right: 0.5rem;
  margin-top: 0.25rem;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.markdown-content :deep(.task-list-item p) {
  margin: 0;
  flex: 1;
}

.markdown-content :deep(.task-list-item.checked) {
  color: #909399;
}

.markdown-content :deep(.task-list-item.checked p) {
  text-decoration: line-through;
}

.markdown-content :deep(.katex-html) {
  display: none !important;
}

</style>

