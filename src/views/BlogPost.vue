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
import { ref, onMounted } from 'vue'
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
    
    onMounted(async () => {
      try {
        const slug = props.slug || route.params.slug
        const markdownContent = await getArticleBySlug(slug)
        
        if (markdownContent) {
          renderedMarkdown.value = renderMarkdown(markdownContent)
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
  margin: auto auto;
  padding: 2rem;
}

.blog-post ::v-deep(.el-button) {
  margin-bottom: 2rem;
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
  width: 1200px;
}

.markdown-content {
  text-align: left;
  background-color: white;
  padding: 2rem;
}

.markdown-content h1 {
  color: #303133;
  border-bottom: 2px solid #409eff;
  padding-bottom: 1rem;
  margin-top: 0;
  font-size: 2rem;
}

.markdown-content h2 {
  color: #606266;
  margin-top: 2rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #ebeef5;
  font-size: 1.5rem;
}

.markdown-content h3 {
  color: #909399;
  margin-top: 1.5rem;
  font-size: 1.25rem;
}

.markdown-content p {
  line-height: 1.8;
  color: #606266;
  margin: 1rem 0;
}

.markdown-content code {
  background-color: #f5f7fa;
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  color: #409eff;
}

.markdown-content pre {
  background-color: #f5f7fa;
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
  margin: 1.5rem 0;
}

.markdown-content pre code {
  background-color: transparent;
  padding: 0;
  color: inherit;
}

.markdown-content blockquote {
  border-left: 4px solid #409eff;
  padding: 0.5rem 1rem;
  background-color: #f5f7fa;
  margin: 1.5rem 0;
  border-radius: 0 4px 4px 0;
}

.markdown-content blockquote p {
  margin: 0;
  color: #606266;
}

.markdown-content ul, .markdown-content ol {
  padding-left: 1.5rem;
  margin: 1rem 0;
}

.markdown-content li {
  margin-bottom: 0.5rem;
}

.markdown-content a {
  color: #409eff;
  text-decoration: none;
}

.markdown-content a:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .blog-post {
    padding: 1rem;
  }
  
  .markdown-content {
    padding: 1rem;
  }
  
  .markdown-content h1 {
    font-size: 1.75rem;
  }
  
  .markdown-content h2 {
    font-size: 1.35rem;
  }
}
</style>