<template>
  <div class="home">
    <el-row :gutter="20">
      <el-col :span="24">
        <div class="search-container">
          <el-input
            v-model="searchQuery"
            placeholder="搜索文章..."
            clearable
            @input="handleSearch"
            size="large"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
      </el-col>
    </el-row>
    
    <!-- 标签筛选栏 -->
    <el-row :gutter="20">
      <el-col :span="24">
        <div class="tag-filter">
          <el-tag 
            v-for="tag in allTags" 
            :key="tag" 
            :type="selectedTag === tag ? 'primary' : 'info'" 
            size="large" 
            @click="filterByTag(tag)"
            class="tag-item"
          >
            {{ tag }}
          </el-tag>
          <el-tag 
            type="info" 
            size="large" 
            @click="clearTagFilter"
            class="tag-item"
          >
            全部
          </el-tag>
        </div>
      </el-col>
    </el-row>
    
    <el-row :gutter="20">
      <el-col :span="24">
        <el-card class="post-card" v-for="post in paginatedPosts" :key="post.slug" @click="goToPost(post.slug)" shadow="hover">
          <h3>{{ post.title }}</h3>
          <p>{{ post.excerpt }}</p>
          <div class="post-meta">
            <el-tag v-if="post.tag" type="success" size="small">{{ post.tag }}</el-tag>
            <span class="post-date" v-if="post.date">{{ formatDate(post.date) }}</span>
          </div>
        </el-card>
      </el-col>
    </el-row>
    
    <el-row :gutter="20">
      <el-col :span="24">
        <el-pagination
        v-if="filteredPosts.length > pageSize"
        v-model:current-page="currentPage"
        :page-size="pageSize"
        layout="prev, pager, next"
        :total="filteredPosts.length"
        class="pagination"
      ></el-pagination>
    </el-col>
  </el-row>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getArticleList } from '../utils/blogUtils'
import { Search } from '@element-plus/icons-vue'

export default {
  name: 'Home',
  components: {
    Search
  },
  setup() {
    const router = useRouter()
    const posts = ref([])
    const searchQuery = ref('')
    const selectedTag = ref('')
    
    // 获取所有标签
    const allTags = computed(() => {
      const tags = posts.value.map(post => post.tag)
      return [...new Set(tags)]
    })
    
    // 获取文章列表
    onMounted(async () => {
      posts.value = await getArticleList()
    })
    
    // 过滤后的文章列表
    const filteredPosts = computed(() => {
      // 先按标签筛选
      let filtered = posts.value
      if (selectedTag.value) {
        filtered = posts.value.filter(post => post.tag === selectedTag.value)
      }
      
      // 再按搜索关键词筛选
      if (!searchQuery.value) {
        return filtered
      }
      
      const query = searchQuery.value.toLowerCase()
      return filtered.filter(post => 
        post.title.toLowerCase().includes(query) || 
        (post.excerpt && post.excerpt.toLowerCase().includes(query)) ||
        (post.tag && post.tag.toLowerCase().includes(query))
      )
    })
    
    const goToPost = (slug) => {
      router.push(`/post/${slug}`)
    }
    
    const formatDate = (dateString) => {
      const options = { year: 'numeric', month: 'long', day: 'numeric' }
      return new Date(dateString).toLocaleDateString('zh-CN', options)
    }
    
    const handleSearch = () => {
      // 搜索功能已在 computed 属性中实现
    }
    
    // 标签筛选
    const filterByTag = (tag) => {
      selectedTag.value = tag
    }
    
    // 清除标签筛选
    const clearTagFilter = () => {
      selectedTag.value = ''
    }
    
    // 分页相关
    const currentPage = ref(1)
    const pageSize = ref(4) // 每页显示4篇文章
    
    // 分页后的文章列表
    const paginatedPosts = computed(() => {
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      return filteredPosts.value.slice(start, end)
    })
    
    return {
      posts,
      filteredPosts,
      paginatedPosts,
      searchQuery,
      selectedTag,
      allTags,
      currentPage,
      pageSize,
      goToPost,
      formatDate,
      handleSearch,
      filterByTag,
      clearTagFilter
    }
  }
}
</script>

<style scoped>
.home {
  padding: 2rem;
}

.search-container {
  margin-bottom: 2rem;
  max-width: 500px;
  max-height: 100px;
  margin-left: auto;
  margin-right: auto;
}

.search-container ::v-deep(.el-input__wrapper) {
  border-radius: 20px;
  box-shadow: 0 0 0 1px #dcdfe6 inset;
  transition: all 0.3s;
}

.search-container ::v-deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #409eff inset;
}

.tag-filter {
  margin-bottom: 2rem;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

.tag-item {
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  border: none;
  border-radius: 20px;
  padding: 0 15px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  background: white;
}

.tag-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  background: linear-gradient(135deg, #f5f7fa 0%, #e6e9f0 100%);
}

.tag-item ::v-deep(.el-tag__content) {
  transition: all 0.3s;
}

.post-card {
  margin-bottom: 1.5rem;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  border: none;
  border-radius: 12px;
  overflow: hidden;
  background: white;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
}

.post-card:hover {
  transform: translateY(-5px) scale(1.01);
  box-shadow: 0 14px 28px rgba(0,0,0,0.12), 0 10px 10px rgba(0,0,0,0.08);
  background: linear-gradient(135deg, #f9fafc 0%, #f5f7fa 100%);
}

.pagination {
  margin-top: 2rem;
  justify-content: center;
}

.post-card h3 {
  margin: 0 0 1rem 0;
  color: #303133;
  font-size: 1.5rem;
}

.post-card p {
  margin: 0 0 1rem 0;
  color: #606266;
  line-height: 1.6;
}

.post-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #ebeef5;
}

.post-date {
  font-size: 0.9rem;
  color: #909399;
}

@media (max-width: 768px) {
  .home {
    padding: 1rem;
  }
  
  .search-container {
    max-width: 100%;
  }
  
  .tag-filter {
    justify-content: flex-start;
  }
  
  .post-card h3 {
    font-size: 1.3rem;
  }
}
</style>