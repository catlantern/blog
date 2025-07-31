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

@media (max-width: 768px) {
  .blog-post {
    padding: 1rem;
  }
}
</style>