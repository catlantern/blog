<template>
  <div class="home">
    <div class="page-header">
      <p class="page-subtitle">记录学习与成长的点滴</p>
    </div>
    
    <div class="search-container">
      <el-input
        v-model="searchQuery"
        placeholder="搜索文章标题、摘要或分类..."
        clearable
        size="large"
        class="search-input"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
    </div>
    
    <div class="category-section">
      <div class="category-header">
        <h3>文章分类</h3>
        <span class="article-count">共 {{ filteredPosts.length }} 篇文章</span>
      </div>
      <div class="category-cards">
        <div 
          :class="['category-card', { active: !selectedTag }]"
          @click="clearTagFilter"
        >
          <div class="category-icon all">
            <el-icon><Grid /></el-icon>
          </div>
          <div class="category-info">
            <span class="category-name">全部文章</span>
            <span class="category-count">{{ posts.length }} 篇</span>
          </div>
        </div>
        <div 
          v-for="tag in tagStats" 
          :key="tag.name"
          :class="['category-card', { active: selectedTag === tag.name }]"
          @click="filterByTag(tag.name)"
        >
          <div class="category-icon" :style="{ backgroundColor: getTagColor(tag.name) }">
            <el-icon><Folder /></el-icon>
          </div>
          <div class="category-info">
            <span class="category-name">{{ tag.name }}</span>
            <span class="category-count">{{ tag.count }} 篇</span>
          </div>
        </div>
      </div>
    </div>
    
    <div class="articles-section" v-if="selectedTag">
      <div class="section-header">
        <h3>{{ selectedTag }} 分类文章</h3>
        <el-button text @click="clearTagFilter">
          <el-icon><Close /></el-icon>
          清除筛选
        </el-button>
      </div>
    </div>
    
    <div class="articles-grid">
      <el-card 
        class="article-card" 
        v-for="post in paginatedPosts" 
        :key="post.slug" 
        @click="goToPost(post.slug)" 
        shadow="hover"
      >
        <div class="article-header">
          <el-tag 
            :style="{ backgroundColor: getTagColor(post.tag), borderColor: getTagColor(post.tag), color: '#fff' }" 
            size="small"
          >
            {{ post.tag }}
          </el-tag>
          <span class="article-date">{{ formatDate(post.date) }}</span>
        </div>
        <h3 class="article-title">{{ post.title }}</h3>
        <p class="article-excerpt">{{ post.excerpt }}</p>
        <div class="article-footer">
          <span class="read-more">阅读全文 →</span>
        </div>
      </el-card>
    </div>
    
    <div class="empty-state" v-if="filteredPosts.length === 0">
      <el-empty description="没有找到相关文章" />
    </div>
    
    <div class="pagination-wrapper" v-if="filteredPosts.length > pageSize">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        layout="prev, pager, next"
        :total="filteredPosts.length"
        background
      />
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getArticleList, getTagStats } from '../utils/blogUtils'
import { Search, Folder, Grid, Close } from '@element-plus/icons-vue'

export default {
  name: 'Home',
  components: {
    Search,
    Folder,
    Grid,
    Close
  },
  setup() {
    const router = useRouter()
    const route = useRoute()
    const posts = ref([])
    const searchQuery = ref('')
    const selectedTag = ref('')
    const tagStats = ref([])
    
    const tagColors = {
      'linux': '#409eff',
      'spring': '#67c23a',
      'C#': '#e6a23c',
      '单片机': '#f56c6c',
      '操作系统': '#909399'
    }
    
    const getTagColor = (tag) => {
      return tagColors[tag] || '#409eff'
    }
    
    onMounted(async () => {
      posts.value = await getArticleList()
      tagStats.value = await getTagStats()
      
      if (route.query.tag) {
        selectedTag.value = route.query.tag
      }
    })
    
    watch(() => route.query.tag, (newTag) => {
      if (newTag) {
        selectedTag.value = newTag
      } else {
        selectedTag.value = ''
      }
    })
    
    const filteredPosts = computed(() => {
      let filtered = posts.value
      
      if (selectedTag.value) {
        filtered = filtered.filter(post => post.tag === selectedTag.value)
      }
      
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase()
        filtered = filtered.filter(post => 
          post.title.toLowerCase().includes(query) || 
          (post.excerpt && post.excerpt.toLowerCase().includes(query)) ||
          (post.tag && post.tag.toLowerCase().includes(query))
        )
      }
      
      return filtered
    })
    
    const goToPost = (slug) => {
      router.push(`/post/${slug}`)
    }
    
    const formatDate = (dateString) => {
      const options = { year: 'numeric', month: 'long', day: 'numeric' }
      return new Date(dateString).toLocaleDateString('zh-CN', options)
    }
    
    const filterByTag = (tag) => {
      selectedTag.value = tag
      router.push({ query: { tag } })
    }
    
    const clearTagFilter = () => {
      selectedTag.value = ''
      router.push({ query: {} })
    }
    
    const currentPage = ref(1)
    const pageSize = ref(8)
    
    const paginatedPosts = computed(() => {
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      return filteredPosts.value.slice(start, end)
    })
    
    watch([selectedTag, searchQuery], () => {
      currentPage.value = 1
    })
    
    return {
      posts,
      filteredPosts,
      paginatedPosts,
      searchQuery,
      selectedTag,
      tagStats,
      currentPage,
      pageSize,
      goToPost,
      formatDate,
      filterByTag,
      clearTagFilter,
      getTagColor
    }
  }
}
</script>

<style scoped>
.home {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  text-align: center;
  margin-bottom: 2rem;
}

.page-subtitle {
  color: #606266;
  font-size: 1.3rem;
  margin: 0;
  font-weight: 500;
  background: linear-gradient(135deg, #3a7bd5 0%, #00d2ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.search-container {
  margin-bottom: 2rem;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.search-input ::v-deep(.el-input__wrapper) {
  border-radius: 25px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 0.5rem 1rem;
}

.search-input ::v-deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.2);
}

.category-section {
  margin-bottom: 2rem;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.category-header h3 {
  margin: 0;
  color: #303133;
  font-size: 1.2rem;
}

.article-count {
  color: #909399;
  font-size: 0.9rem;
}

.category-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.category-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: white;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 2px solid transparent;
}

.category-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

.category-card.active {
  border-color: #409eff;
  background: linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%);
}

.category-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
  color: white;
  font-size: 1.2rem;
}

.category-icon.all {
  background: linear-gradient(135deg, #67c23a 0%, #85ce61 100%);
}

.category-info {
  display: flex;
  flex-direction: column;
}

.category-name {
  font-weight: 500;
  color: #303133;
  font-size: 0.95rem;
}

.category-count {
  font-size: 0.8rem;
  color: #909399;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.section-header h3 {
  margin: 0;
  color: #303133;
}

.articles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

.article-card {
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  border: none;
  border-radius: 16px;
  overflow: hidden;
  background: white;
}

.article-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15);
}

.article-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.article-date {
  font-size: 0.85rem;
  color: #909399;
}

.article-title {
  margin: 0 0 0.75rem 0;
  color: #303133;
  font-size: 1.25rem;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.article-excerpt {
  margin: 0 0 1rem 0;
  color: #606266;
  line-height: 1.6;
  font-size: 0.9rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.article-footer {
  padding-top: 1rem;
  border-top: 1px solid #f0f0f0;
}

.read-more {
  color: #409eff;
  font-size: 0.9rem;
  font-weight: 500;
}

.empty-state {
  padding: 3rem 0;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 2rem;
  padding: 1rem 0;
}

@media (max-width: 768px) {
  .home {
    padding: 1rem;
  }
  
  .page-subtitle {
    font-size: 1.1rem;
  }
  
  .category-cards {
    gap: 0.75rem;
  }
  
  .category-card {
    padding: 0.75rem 1rem;
  }
  
  .articles-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
