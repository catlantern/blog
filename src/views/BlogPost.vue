<template>
  <div class="blog-post-page">
    <div class="blog-post-container">
      <div class="left-sidebar" v-if="headings.length > 0">
        <div class="toc-wrapper">
          <h4 class="toc-title">目录</h4>
          <div class="toc-list">
            <a
              v-for="heading in headings"
              :key="heading.id"
              :href="'#' + heading.id"
              :class="['toc-item', 'level-' + heading.level, { active: activeHeading === heading.id }]"
              @click.prevent="scrollToHeading(heading.id)"
            >
              {{ heading.text }}
            </a>
          </div>
        </div>
      </div>
      
      <div class="main-content">
        <el-card class="post-content">
          <div class="post-header">
            <h1 class="post-title">{{ articleInfo?.title || '加载中...' }}</h1>
            <div class="post-meta-info">
              <el-tag v-if="articleInfo?.tag" type="success" size="default">{{ articleInfo.tag }}</el-tag>
              <span class="post-date" v-if="articleInfo?.date">{{ formatDate(articleInfo.date) }}</span>
            </div>
          </div>
          <div class="markdown-content" v-html="renderedMarkdown"></div>
        </el-card>
      </div>
      
      <div class="right-sidebar">
        <div class="category-wrapper">
          <h4 class="category-title">文章分类</h4>
          <div class="category-list">
            <div
              v-for="tag in tagStats"
              :key="tag.name"
              :class="['category-item', { active: articleInfo?.tag === tag.name }]"
              @click="goToCategory(tag.name)"
            >
              <span class="category-name">{{ tag.name }}</span>
              <el-badge :value="tag.count" type="primary" />
            </div>
          </div>
        </div>
        <div class="nav-wrapper">
          <h4 class="nav-wrapper-title">文章导航</h4>
          <div class="nav-link-item" v-if="adjacentArticles.prev" @click="goToPost(adjacentArticles.prev.slug)">
            <span class="nav-link-label"><el-icon><ArrowLeft /></el-icon> 上一篇</span>
            <span class="nav-link-title">{{ adjacentArticles.prev.title }}</span>
          </div>
          <div class="nav-link-item disabled" v-else>
            <span class="nav-link-label"><el-icon><ArrowLeft /></el-icon> 上一篇</span>
            <span class="nav-link-title">没有更多文章了</span>
          </div>
          <div class="nav-link-item" v-if="adjacentArticles.next" @click="goToPost(adjacentArticles.next.slug)">
            <span class="nav-link-label">下一篇 <el-icon><ArrowRight /></el-icon></span>
            <span class="nav-link-title">{{ adjacentArticles.next.title }}</span>
          </div>
          <div class="nav-link-item disabled" v-else>
            <span class="nav-link-label">下一篇 <el-icon><ArrowRight /></el-icon></span>
            <span class="nav-link-title">没有更多文章了</span>
          </div>
        </div>
        <div class="home-wrapper">
          <el-button type="primary" @click="goBack" round class="home-button">
            <el-icon><HomeFilled /></el-icon>
            返回首页
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, nextTick, computed, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { 
  getArticleBySlug, 
  renderMarkdown, 
  extractHeadings,
  getAdjacentArticles,
  getTagStats,
  getCurrentArticleInfo
} from '../utils/blogUtils'
import { ArrowLeft, ArrowRight, HomeFilled } from '@element-plus/icons-vue'

export default {
  name: 'BlogPost',
  components: {
    ArrowLeft,
    ArrowRight,
    HomeFilled
  },
  props: ['slug'],
  setup(props) {
    const route = useRoute()
    const router = useRouter()
    const renderedMarkdown = ref('')
    const headings = ref([])
    const activeHeading = ref('')
    const articleInfo = ref(null)
    const adjacentArticles = ref({ prev: null, next: null })
    const tagStats = ref([])
    const currentSlug = computed(() => props.slug || route.params.slug)
    
    const goBack = () => {
      router.push('/')
    }
    
    const goToPost = (slug) => {
      router.push(`/post/${slug}`)
    }
    
    const goToCategory = (tag) => {
      router.push(`/?tag=${tag}`)
    }
    
    const formatDate = (dateString) => {
      const options = { year: 'numeric', month: 'long', day: 'numeric' }
      return new Date(dateString).toLocaleDateString('zh-CN', options)
    }
    
    const scrollToHeading = (id) => {
      const element = document.getElementById(id)
      if (element) {
        const headerOffset = 80
        const elementPosition = element.getBoundingClientRect().top
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset
        
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        })
        activeHeading.value = id
      }
    }
    
    const addHeadingIds = () => {
      const content = document.querySelector('.markdown-content')
      if (!content) return
      
      const headingElements = content.querySelectorAll('h1, h2, h3, h4, h5, h6')
      headings.value.forEach((heading, index) => {
        if (headingElements[index]) {
          headingElements[index].id = heading.id
        }
      })
    }
    
    const handleScroll = () => {
      const headingElements = document.querySelectorAll('.markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4, .markdown-content h5, .markdown-content h6')
      const headerOffset = 100
      
      for (let i = headingElements.length - 1; i >= 0; i--) {
        const element = headingElements[i]
        const rect = element.getBoundingClientRect()
        
        if (rect.top <= headerOffset) {
          activeHeading.value = element.id
          return
        }
      }
      
      if (headingElements.length > 0) {
        activeHeading.value = headingElements[0].id
      }
    }
    
    const copyCode = (button) => {
      const codeBlock = button.closest('.code-block-wrapper')
      const codeContainer = codeBlock.querySelector('.code-container code')
      const codeText = codeContainer.innerText
      
      navigator.clipboard.writeText(codeText).then(() => {
        const originalText = button.innerText
        button.innerText = '已复制'
        button.classList.add('copied')
        
        setTimeout(() => {
          button.innerText = originalText
          button.classList.remove('copied')
        }, 2000)
      }).catch(err => {
        console.error('复制失败:', err)
      })
    }
    
    const toggleFullscreen = (button) => {
      const codeBlock = button.closest('.code-block-wrapper')
      
      if (!document.fullscreenElement) {
        if (codeBlock.requestFullscreen) {
          codeBlock.requestFullscreen()
        } else if (codeBlock.webkitRequestFullscreen) {
          codeBlock.webkitRequestFullscreen()
        } else if (codeBlock.msRequestFullscreen) {
          codeBlock.msRequestFullscreen()
        }
        button.innerText = '退出全屏'
      } else {
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
    
    const handleCodeBlockEvents = () => {
      document.addEventListener('click', (event) => {
        if (event.target.classList.contains('copy-button')) {
          copyCode(event.target)
        }
        
        if (event.target.classList.contains('full-scrren-button')) {
          toggleFullscreen(event.target)
        }
      })
    }
    
    const loadArticle = async () => {
      try {
        const slug = currentSlug.value
        const markdownContent = await getArticleBySlug(slug)
        
        if (markdownContent) {
          headings.value = extractHeadings(markdownContent)
          renderedMarkdown.value = renderMarkdown(markdownContent)
          
          articleInfo.value = await getCurrentArticleInfo(slug)
          adjacentArticles.value = await getAdjacentArticles(slug)
          tagStats.value = await getTagStats()
          
          nextTick(() => {
            addHeadingIds()
            handleCodeBlockEvents()
            window.addEventListener('scroll', handleScroll)
            handleScroll()
          })
        } else {
          renderedMarkdown.value = '<p>文章未找到</p>'
        }
      } catch (error) {
        console.error('Error loading blog post:', error)
        renderedMarkdown.value = '<p>文章加载失败</p>'
      }
    }
    
    onMounted(() => {
      loadArticle()
    })

    watch(currentSlug, (newSlug) => {
      if (newSlug) {
        window.scrollTo({ top: 0, behavior: 'smooth' })
        loadArticle()
      }
    })
    
    onUnmounted(() => {
      window.removeEventListener('scroll', handleScroll)
    })
    
    return {
      renderedMarkdown,
      headings,
      activeHeading,
      articleInfo,
      adjacentArticles,
      tagStats,
      currentSlug,
      goBack,
      goToPost,
      goToCategory,
      formatDate,
      scrollToHeading
    }
  }
}
</script>

<style scoped>
.blog-post-page {
  width: 100%;
}

.blog-post-container {
  display: flex;
  max-width: 1600px;
  margin: 0 auto;
  padding: 2rem;
  gap: 1.5rem;
  align-items: flex-start;
}

.left-sidebar {
  width: 300px;
  flex-shrink: 0;
  position: sticky;
  top: 80px;
  align-self: flex-start;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.toc-wrapper {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.toc-title {
  margin: 0 0 1rem 0;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid #409eff;
  color: #303133;
  font-size: 1.1rem;
}

.toc-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.toc-item {
  color: #606266;
  text-decoration: none;
  font-size: 0.9rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  transition: all 0.3s;
  cursor: pointer;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-item:hover {
  background-color: #ecf5ff;
  color: #409eff;
}

.toc-item.active {
  background-color: #409eff;
  color: white;
}

.toc-item.level-2 {
  padding-left: 0.5rem;
}

.toc-item.level-3 {
  padding-left: 1rem;
  font-size: 0.85rem;
}

.toc-item.level-4 {
  padding-left: 1.5rem;
  font-size: 0.8rem;
}

.toc-item.level-5,
.toc-item.level-6 {
  padding-left: 2rem;
  font-size: 0.75rem;
  color: #909399;
}

.main-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.post-content {
  border: none;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.post-header {
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid #ebeef5;
}

.post-title {
  margin: 0 0 1rem 0;
  color: #303133;
  font-size: 2rem;
  line-height: 1.4;
}

.post-meta-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.post-date {
  color: #909399;
  font-size: 0.9rem;
}

.right-sidebar {
  width: 300px;
  flex-shrink: 0;
  position: sticky;
  top: 80px;
  align-self: flex-start;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.category-wrapper {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.category-title {
  margin: 0 0 1rem 0;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid #67c23a;
  color: #303133;
  font-size: 1.1rem;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.category-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: #f5f7fa;
}

.category-item:hover {
  background-color: #e6f7d9;
}

.category-item.active {
  background-color: #67c23a;
  color: white;
}

.category-name {
  font-size: 0.9rem;
}

.nav-wrapper {
  margin-top: 1rem;
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.nav-wrapper-title {
  margin: 0 0 1rem 0;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid #409eff;
  color: #303133;
  font-size: 1.1rem;
}

.nav-link-item {
  padding: 0.8rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: #f5f7fa;
  margin-bottom: 0.5rem;
}

.nav-link-item:last-child {
  margin-bottom: 0;
}

.nav-link-item:hover {
  background-color: #ecf5ff;
}

.nav-link-item.disabled {
  opacity: 0.5;
  cursor: default;
}

.nav-link-item.disabled:hover {
  background-color: #f5f7fa;
}

.nav-link-label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: #909399;
  margin-bottom: 0.3rem;
}

.nav-link-title {
  font-size: 0.9rem;
  color: #303133;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
}

.nav-link-item:not(.disabled) .nav-link-title {
  color: #409eff;
}

.home-wrapper {
  margin-top: 1rem;
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  display: flex;
  justify-content: center;
}

.home-button {
  width: 100%;
}

@media (max-width: 1200px) {
  .left-sidebar {
    display: none;
  }
  
  .right-sidebar {
    width: 250px;
  }
}

@media (max-width: 900px) {
  .right-sidebar {
    display: none;
  }
  
  .blog-post-container {
    padding: 1rem;
  }
}

@media (max-width: 768px) {
  .post-title {
    font-size: 1.5rem;
  }
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  scroll-margin-top: 80px;
}

.markdown-content :deep(code) {
  background-color: #f7c8c8;
  border-radius: 4px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85em;
}

.markdown-content :deep(.code-block-wrapper) {
  background-color: #f0f0f0;
  border-radius: 6px;
  margin: 1rem 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.markdown-content :deep(.code-header) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.8em;
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.markdown-content :deep(.copy-button) {
  cursor: pointer;
  padding: 2px 8px;
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  transition: all 0.3s;
  margin-left: auto;
  margin-right: 8px;
}

.markdown-content :deep(.full-scrren-button) {
  cursor: pointer;
  padding: 2px 8px;
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  transition: all 0.3s;
}

.markdown-content :deep(.copy-button:hover),
.markdown-content :deep(.full-scrren-button:hover) {
  background-color: #e0e0e0;
  transform: translateY(-1px);
}

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
