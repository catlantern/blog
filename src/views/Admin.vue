<template>
  <div class="admin-container">
    <div class="admin-header">
      <h1>文章管理</h1>
      <p>导入文章、管理标签和文章</p>
    </div>
    
    <div class="api-status" :class="{ connected: apiConnected, disconnected: !apiConnected }">
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span class="status-text">{{ apiConnected ? '本地API已连接' : '本地API未连接' }}</span>
      </div>
      <div class="status-actions">
        <el-button v-if="!apiConnected" type="primary" size="small" @click="checkApiConnection">
          重试连接
        </el-button>
      </div>
    </div>
    
    <el-alert
      v-if="!apiConnected"
      title="提示"
      type="info"
      description="本地API未连接，部分功能不可用。运行 'pnpm api' 启动本地API服务。"
      :closable="false"
      show-icon
      style="margin-bottom: 1.5rem;"
    />
    
    <div class="admin-content">
      <div class="import-section">
        <el-input 
          v-model="sourceMdPath" 
          placeholder="请输入MD文件完整路径，如 C:\Users\Desktop\test.md"
          clearable
          size="large"
          @keyup.enter="importMarkdown"
        >
          <template #prepend>文件路径</template>
          <template #append>
            <el-button type="primary" @click="importMarkdown" :loading="isImporting">
              导入
            </el-button>
          </template>
        </el-input>
        <p class="import-hint">输入MD文件路径后点击导入，系统会自动将本地图片转为base64嵌入，将file:///链接转为代码引用</p>
      </div>

      <div class="management-section" v-if="apiConnected">
        <el-tabs v-model="activeTab" type="border-card">
          
          <el-tab-pane label="导入文章" name="import">
            <div class="tab-content" v-if="articleContent">
              <div class="form-preview-grid">
                <el-card class="form-card">
                  <template #header>
                    <div class="card-header">
                      <span>文章信息设置</span>
                      <el-tag type="success" v-if="fileName">{{ fileName }}</el-tag>
                    </div>
                  </template>
                  <el-form :model="articleForm" label-width="80px" class="article-form">
                    <el-form-item label="标题" required>
                      <el-input v-model="articleForm.title" placeholder="请输入文章标题" />
                    </el-form-item>
                    <el-form-item label="分类" required>
                      <el-select 
                        v-model="articleForm.tag" 
                        filterable 
                        allow-create
                        default-first-option
                        placeholder="选择或创建分类"
                      >
                        <el-option
                          v-for="tag in existingTags"
                          :key="tag"
                          :label="tag"
                          :value="tag"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="摘要" required>
                      <el-input 
                        v-model="articleForm.excerpt" 
                        type="textarea" 
                        :rows="3"
                        placeholder="请输入文章摘要"
                      />
                    </el-form-item>
                    <el-form-item label="日期">
                      <el-date-picker
                        v-model="articleForm.date"
                        type="date"
                        placeholder="选择日期"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                      />
                    </el-form-item>
                    <el-form-item label="文件名">
                      <el-input v-model="articleForm.slug" placeholder="自动生成的文件名">
                        <template #append>.md</template>
                      </el-input>
                    </el-form-item>
                  </el-form>
                  <div class="form-actions">
                    <el-button @click="resetForm">重置</el-button>
                    <el-button type="primary" @click="saveArticle" :disabled="!isFormValid">
                      保存文章
                    </el-button>
                  </div>
                </el-card>
                
                <el-card class="preview-card">
                  <template #header>
                    <div class="card-header">
                      <span>内容预览</span>
                      <el-button-group>
                        <el-button 
                          :type="previewMode === 'markdown' ? 'primary' : 'default'"
                          size="small"
                          @click="previewMode = 'markdown'"
                        >
                          Markdown
                        </el-button>
                        <el-button 
                          :type="previewMode === 'rendered' ? 'primary' : 'default'"
                          size="small"
                          @click="previewMode = 'rendered'"
                        >
                          渲染预览
                        </el-button>
                      </el-button-group>
                    </div>
                  </template>
                  <div class="preview-content" v-if="previewMode === 'markdown'">
                    <pre>{{ articleContent }}</pre>
                  </div>
                  <div class="preview-content rendered" v-else v-html="renderedPreview"></div>
                </el-card>
              </div>
            </div>
            <div class="empty-state" v-else>
              <el-icon class="empty-icon"><Upload /></el-icon>
              <p>请在上方输入MD文件路径并点击导入</p>
            </div>
          </el-tab-pane>
          
          <el-tab-pane label="标签管理" name="tags">
            <div class="tab-content">
              <div class="tag-toolbar">
                <div class="tag-add-row">
                  <el-input 
                    v-model="newTagName" 
                    placeholder="输入新标签名称"
                    clearable
                    style="max-width: 300px;"
                    @keyup.enter="addTag"
                  >
                    <template #append>
                      <el-button @click="addTag" :disabled="!newTagName.trim()">添加标签</el-button>
                    </template>
                  </el-input>
                </div>
                <div class="batch-actions" v-if="selectedTags.length > 0">
                  <span class="selection-info">已选 {{ selectedTags.length }} 个标签</span>
                  <el-button size="small" @click="selectedTags = []">取消选择</el-button>
                  <el-popconfirm
                    :title="`确定删除选中的 ${selectedTags.length} 个标签及其所有文章吗？此操作不可恢复！`"
                    confirm-button-text="删除"
                    cancel-button-text="取消"
                    confirm-button-type="danger"
                    @confirm="batchDeleteTags"
                  >
                    <template #reference>
                      <el-button size="small" type="danger">批量删除</el-button>
                    </template>
                  </el-popconfirm>
                </div>
              </div>
              <div class="tag-list">
                <div class="tag-item" v-for="tag in tagList" :key="tag.name">
                  <el-checkbox 
                    v-model="tag._selected" 
                    @change="(val) => toggleTagSelection(tag.name, val)"
                  />
                  <div class="tag-info">
                    <el-tag size="large" effect="plain">{{ tag.name }}</el-tag>
                    <span class="tag-count">{{ tag.count }} 篇文章</span>
                  </div>
                  <div class="tag-actions">
                    <el-button size="small" @click="openRenameDialog(tag.name)">重命名</el-button>
                    <el-popconfirm
                      :title="`确定删除标签「${tag.name}」及其 ${tag.count} 篇文章吗？此操作不可恢复！`"
                      confirm-button-text="删除"
                      cancel-button-text="取消"
                      confirm-button-type="danger"
                      @confirm="deleteTag(tag.name)"
                    >
                      <template #reference>
                        <el-button size="small" type="danger">删除</el-button>
                      </template>
                    </el-popconfirm>
                  </div>
                </div>
                <div class="empty-state" v-if="tagList.length === 0">
                  <p>暂无标签</p>
                </div>
              </div>
            </div>
          </el-tab-pane>
          
          <el-tab-pane label="文章列表" name="articles">
            <div class="tab-content">
              <div class="article-toolbar">
                <div class="article-filter">
                  <el-select 
                    v-model="filterTag" 
                    placeholder="按标签筛选" 
                    clearable
                    style="max-width: 200px;"
                  >
                    <el-option
                      v-for="tag in tagList"
                      :key="tag.name"
                      :label="`${tag.name} (${tag.count})`"
                      :value="tag.name"
                    />
                  </el-select>
                  <el-input 
                    v-model="searchKeyword" 
                    placeholder="搜索文章标题"
                    clearable
                    style="max-width: 300px;"
                  />
                </div>
                <div class="batch-actions" v-if="selectedArticles.length > 0">
                  <span class="selection-info">已选 {{ selectedArticles.length }} 篇文章</span>
                  <el-button size="small" @click="clearArticleSelection">取消选择</el-button>
                  <el-popconfirm
                    :title="`确定删除选中的 ${selectedArticles.length} 篇文章吗？此操作不可恢复！`"
                    confirm-button-text="删除"
                    cancel-button-text="取消"
                    confirm-button-type="danger"
                    @confirm="batchDeleteArticles"
                  >
                    <template #reference>
                      <el-button size="small" type="danger">批量删除</el-button>
                    </template>
                  </el-popconfirm>
                </div>
              </div>
              <div class="article-list">
                <div class="article-item" v-for="article in filteredArticles" :key="article.slug">
                  <el-checkbox 
                    :model-value="selectedArticles.includes(article.slug)"
                    @change="(val) => toggleArticleSelection(article.slug, val)"
                  />
                  <div class="article-info">
                    <span class="article-title">{{ article.title }}</span>
                    <div class="article-meta">
                      <el-tag size="small" type="success">{{ article.tag }}</el-tag>
                      <span class="article-date">{{ article.date }}</span>
                    </div>
                  </div>
                  <div class="article-item-actions">
                    <el-button size="small" @click="previewArticle(article.slug)" :loading="previewingSlug === article.slug">预览</el-button>
                    <el-button size="small" type="primary" @click="openEditDialog(article)">编辑</el-button>
                    <el-popconfirm
                      :title="`确定删除文章「${article.title}」吗？此操作不可恢复！`"
                      confirm-button-text="删除"
                      cancel-button-text="取消"
                      confirm-button-type="danger"
                      @confirm="deleteArticle(article.slug)"
                    >
                      <template #reference>
                        <el-button size="small" type="danger">删除</el-button>
                      </template>
                    </el-popconfirm>
                  </div>
                </div>
                <div class="empty-state" v-if="filteredArticles.length === 0">
                  <p>暂无文章</p>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>
    
    <el-dialog v-model="showSuccessDialog" title="成功" width="400px" center>
      <div class="success-content">
        <el-icon class="success-icon"><SuccessFilled /></el-icon>
        <p>{{ saveMessage }}</p>
      </div>
    </el-dialog>
    
    <el-dialog v-model="showRenameDialog" title="重命名标签" width="400px" center>
      <el-form label-width="80px">
        <el-form-item label="当前名称">
          <el-input :model-value="renameOldName" disabled />
        </el-form-item>
        <el-form-item label="新名称">
          <el-input v-model="renameNewName" placeholder="请输入新标签名称" @keyup.enter="renameTag" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="renameTag" :disabled="!renameNewName.trim()">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditDialog" title="编辑文章信息" width="500px" center>
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="editForm.title" placeholder="文章标题" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select 
            v-model="editForm.tag" 
            filterable 
            allow-create
            default-first-option
            placeholder="选择或创建标签"
          >
            <el-option
              v-for="tag in tagNames"
              :key="tag"
              :label="tag"
              :value="tag"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="摘要">
          <el-input v-model="editForm.excerpt" type="textarea" :rows="3" placeholder="文章摘要" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="editForm.date"
            type="date"
            placeholder="选择日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="updateArticleMeta" :disabled="!editForm.title || !editForm.tag">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showPreviewDialog" :title="previewTitle" width="800px" top="5vh" destroy-on-close>
      <div class="preview-dialog-content" v-html="previewHtml"></div>
    </el-dialog>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue'
import { Upload, SuccessFilled } from '@element-plus/icons-vue'
import { getAllTags, renderMarkdown } from '../utils/blogUtils'

const API_URL = 'http://localhost:3001'

export default {
  name: 'Admin',
  components: {
    Upload,
    SuccessFilled
  },
  setup() {
    const fileName = ref('')
    const articleContent = ref('')
    const existingTags = ref([])
    const previewMode = ref('markdown')
    const showSuccessDialog = ref(false)
    const saveMessage = ref('')
    const apiConnected = ref(false)
    const sourceMdPath = ref('')
    const isImporting = ref(false)
    const activeTab = ref('import')
    const tagList = ref([])
    const articleList = ref([])
    const filterTag = ref('')
    const searchKeyword = ref('')
    const newTagName = ref('')
    const showRenameDialog = ref(false)
    const renameOldName = ref('')
    const renameNewName = ref('')
    const selectedTags = ref([])
    const selectedArticles = ref([])
    const showEditDialog = ref(false)
    const editForm = ref({ slug: '', title: '', tag: '', excerpt: '', date: '' })
    const showPreviewDialog = ref(false)
    const previewTitle = ref('')
    const previewHtml = ref('')
    const previewingSlug = ref('')
    
    const articleForm = ref({
      title: '',
      tag: '',
      excerpt: '',
      date: new Date().toISOString().split('T')[0],
      slug: ''
    })
    
    const isFormValid = computed(() => {
      return articleForm.value.title && 
             articleForm.value.tag && 
             articleForm.value.excerpt && 
             articleForm.value.slug
    })
    
    const renderedPreview = computed(() => {
      if (!articleContent.value) return ''
      return renderMarkdown(articleContent.value)
    })
    
    const tagNames = computed(() => tagList.value.map(t => t.name))
    
    const filteredArticles = computed(() => {
      let list = articleList.value
      if (filterTag.value) {
        list = list.filter(a => a.tag === filterTag.value)
      }
      if (searchKeyword.value.trim()) {
        const kw = searchKeyword.value.trim().toLowerCase()
        list = list.filter(a => a.title.toLowerCase().includes(kw))
      }
      return list
    })
    
    const checkApiConnection = async () => {
      try {
        const res = await fetch(`${API_URL}/api/articles`, { 
          method: 'GET',
          signal: AbortSignal.timeout(2000)
        })
        apiConnected.value = res.ok
        if (res.ok) {
          await loadAllData()
        }
      } catch (error) {
        apiConnected.value = false
      }
    }
    
    const loadAllData = async () => {
      await Promise.all([loadTags(), loadArticles(), loadExistingTags()])
    }
    
    const loadTags = async () => {
      try {
        const res = await fetch(`${API_URL}/api/tags`)
        if (res.ok) {
          tagList.value = await res.json()
        }
      } catch (error) {
        console.error('加载标签失败:', error)
      }
    }
    
    const loadArticles = async () => {
      try {
        const res = await fetch(`${API_URL}/api/articles`)
        if (res.ok) {
          articleList.value = await res.json()
        }
      } catch (error) {
        console.error('加载文章列表失败:', error)
      }
    }
    
    const loadExistingTags = async () => {
      existingTags.value = await getAllTags()
    }
    
    onMounted(() => {
      checkApiConnection()
    })
    
    watch(() => articleForm.value.title, (newTitle) => {
      if (newTitle) {
        articleForm.value.slug = generateSlug(newTitle)
      }
    })
    
    const generateSlug = (title) => {
      return title
        .toLowerCase()
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50)
    }
    
    const importMarkdown = async () => {
      if (!sourceMdPath.value.trim()) {
        alert('请输入MD文件路径')
        return
      }
      
      isImporting.value = true
      try {
        const res = await fetch(`${API_URL}/api/import-markdown`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mdFilePath: sourceMdPath.value.trim() })
        })
        const data = await res.json()
        
        if (data.success) {
          articleContent.value = data.content
          fileName.value = data.meta.fileName
          
          if (data.meta.title) {
            articleForm.value.title = data.meta.title
          }
          if (data.meta.slug) {
            articleForm.value.slug = data.meta.slug
          }
          if (data.meta.excerpt) {
            articleForm.value.excerpt = data.meta.excerpt
          }
          activeTab.value = 'import'
        } else {
          alert('导入失败: ' + data.error)
        }
      } catch (error) {
        alert('导入失败: ' + error.message)
      } finally {
        isImporting.value = false
      }
    }
    
    const resetForm = () => {
      articleForm.value = {
        title: '',
        tag: '',
        excerpt: '',
        date: new Date().toISOString().split('T')[0],
        slug: ''
      }
      articleContent.value = ''
      fileName.value = ''
    }
    
    const saveArticle = async () => {
      try {
        const res = await fetch(`${API_URL}/api/articles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: articleForm.value.slug,
            title: articleForm.value.title,
            tag: articleForm.value.tag,
            excerpt: articleForm.value.excerpt,
            date: articleForm.value.date,
            content: articleContent.value
          })
        })
        const data = await res.json()
        if (data.success) {
          saveMessage.value = '文章已保存！'
          showSuccessDialog.value = true
          resetForm()
          loadAllData()
        } else {
          alert('保存失败: ' + data.error)
        }
      } catch (error) {
        alert('保存失败: ' + error.message)
      }
    }
    
    const addTag = async () => {
      if (!newTagName.value.trim()) return
      try {
        const res = await fetch(`${API_URL}/api/articles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: '_tag_placeholder_' + Date.now(),
            title: '占位文章',
            tag: newTagName.value.trim(),
            excerpt: '此文章用于创建新标签，可删除',
            date: new Date().toISOString().split('T')[0],
            content: '# 占位文章\n\n此文章用于创建新标签，可删除。'
          })
        })
        const data = await res.json()
        if (data.success) {
          newTagName.value = ''
          saveMessage.value = `标签已创建（含占位文章，可自行删除）`
          showSuccessDialog.value = true
          loadAllData()
        } else {
          alert('添加标签失败: ' + data.error)
        }
      } catch (error) {
        alert('添加标签失败: ' + error.message)
      }
    }
    
    const deleteTag = async (tagName) => {
      try {
        const res = await fetch(`${API_URL}/api/tags/${encodeURIComponent(tagName)}`, {
          method: 'DELETE'
        })
        const data = await res.json()
        if (data.success) {
          saveMessage.value = data.message
          showSuccessDialog.value = true
          selectedTags.value = selectedTags.value.filter(n => n !== tagName)
          loadAllData()
        } else {
          alert('删除标签失败: ' + data.error)
        }
      } catch (error) {
        alert('删除标签失败: ' + error.message)
      }
    }
    
    const toggleTagSelection = (name, val) => {
      if (val) {
        if (!selectedTags.value.includes(name)) {
          selectedTags.value.push(name)
        }
      } else {
        selectedTags.value = selectedTags.value.filter(n => n !== name)
      }
    }
    
    const batchDeleteTags = async () => {
      try {
        const res = await fetch(`${API_URL}/api/tags/batch-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: selectedTags.value })
        })
        const data = await res.json()
        if (data.success) {
          saveMessage.value = data.message
          showSuccessDialog.value = true
          selectedTags.value = []
          loadAllData()
        } else {
          alert('批量删除失败: ' + data.error)
        }
      } catch (error) {
        alert('批量删除失败: ' + error.message)
      }
    }
    
    const openRenameDialog = (name) => {
      renameOldName.value = name
      renameNewName.value = name
      showRenameDialog.value = true
    }
    
    const renameTag = async () => {
      if (!renameNewName.value.trim()) return
      try {
        const res = await fetch(`${API_URL}/api/tags/${encodeURIComponent(renameOldName.value)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName: renameNewName.value.trim() })
        })
        const data = await res.json()
        if (data.success) {
          showRenameDialog.value = false
          saveMessage.value = data.message
          showSuccessDialog.value = true
          loadAllData()
        } else {
          alert('重命名失败: ' + data.error)
        }
      } catch (error) {
        alert('重命名失败: ' + error.message)
      }
    }
    
    const deleteArticle = async (slug) => {
      try {
        const res = await fetch(`${API_URL}/api/articles/${encodeURIComponent(slug)}`, {
          method: 'DELETE'
        })
        const data = await res.json()
        if (data.success) {
          saveMessage.value = '文章已删除'
          showSuccessDialog.value = true
          selectedArticles.value = selectedArticles.value.filter(s => s !== slug)
          loadAllData()
        } else {
          alert('删除文章失败: ' + data.error)
        }
      } catch (error) {
        alert('删除文章失败: ' + error.message)
      }
    }
    
    const toggleArticleSelection = (slug, val) => {
      if (val) {
        if (!selectedArticles.value.includes(slug)) {
          selectedArticles.value.push(slug)
        }
      } else {
        selectedArticles.value = selectedArticles.value.filter(s => s !== slug)
      }
    }
    
    const clearArticleSelection = () => {
      selectedArticles.value = []
    }
    
    const batchDeleteArticles = async () => {
      try {
        const res = await fetch(`${API_URL}/api/articles/batch-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: selectedArticles.value })
        })
        const data = await res.json()
        if (data.success) {
          saveMessage.value = data.message
          showSuccessDialog.value = true
          selectedArticles.value = []
          loadAllData()
        } else {
          alert('批量删除失败: ' + data.error)
        }
      } catch (error) {
        alert('批量删除失败: ' + error.message)
      }
    }
    
    const openEditDialog = (article) => {
      editForm.value = {
        slug: article.slug,
        title: article.title,
        tag: article.tag,
        excerpt: article.excerpt,
        date: article.date
      }
      showEditDialog.value = true
    }
    
    const updateArticleMeta = async () => {
      try {
        const res = await fetch(`${API_URL}/api/articles/${encodeURIComponent(editForm.value.slug)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editForm.value.title,
            tag: editForm.value.tag,
            excerpt: editForm.value.excerpt,
            date: editForm.value.date
          })
        })
        const data = await res.json()
        if (data.success) {
          showEditDialog.value = false
          saveMessage.value = '文章信息已更新'
          showSuccessDialog.value = true
          loadAllData()
        } else {
          alert('更新失败: ' + data.error)
        }
      } catch (error) {
        alert('更新失败: ' + error.message)
      }
    }
    
    const previewArticle = async (slug) => {
      previewingSlug.value = slug
      try {
        const res = await fetch(`${API_URL}/api/articles/${encodeURIComponent(slug)}/content`)
        const data = await res.json()
        if (data.success) {
          const article = articleList.value.find(a => a.slug === slug)
          previewTitle.value = article ? article.title : slug
          previewHtml.value = renderMarkdown(data.content)
          showPreviewDialog.value = true
        } else {
          alert('加载预览失败: ' + data.error)
        }
      } catch (error) {
        alert('加载预览失败: ' + error.message)
      } finally {
        previewingSlug.value = ''
      }
    }
    
    return {
      fileName,
      articleContent,
      existingTags,
      previewMode,
      showSuccessDialog,
      saveMessage,
      apiConnected,
      sourceMdPath,
      isImporting,
      activeTab,
      tagList,
      tagNames,
      articleList,
      filterTag,
      searchKeyword,
      newTagName,
      showRenameDialog,
      renameOldName,
      renameNewName,
      selectedTags,
      selectedArticles,
      showEditDialog,
      editForm,
      showPreviewDialog,
      previewTitle,
      previewHtml,
      previewingSlug,
      articleForm,
      isFormValid,
      renderedPreview,
      filteredArticles,
      checkApiConnection,
      importMarkdown,
      resetForm,
      saveArticle,
      addTag,
      deleteTag,
      toggleTagSelection,
      batchDeleteTags,
      openRenameDialog,
      renameTag,
      deleteArticle,
      toggleArticleSelection,
      clearArticleSelection,
      batchDeleteArticles,
      openEditDialog,
      updateArticleMeta,
      previewArticle
    }
  }
}
</script>

<style scoped>
.admin-container {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.admin-header {
  text-align: center;
  margin-bottom: 2rem;
}

.admin-header h1 {
  margin: 0 0 0.5rem 0;
  color: #303133;
  font-size: 2rem;
}

.admin-header p {
  margin: 0;
  color: #909399;
}

.api-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-radius: 12px;
  margin-bottom: 1.5rem;
}

.api-status.connected {
  background: linear-gradient(135deg, #f0f9eb 0%, #e1f3d8 100%);
  border: 1px solid #67c23a;
}

.api-status.disconnected {
  background: linear-gradient(135deg, #fdf6ec 0%, #faecd8 100%);
  border: 1px solid #e6a23c;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.api-status.connected .status-dot {
  background-color: #67c23a;
  box-shadow: 0 0 8px rgba(103, 194, 58, 0.5);
}

.api-status.disconnected .status-dot {
  background-color: #e6a23c;
  box-shadow: 0 0 8px rgba(230, 162, 60, 0.5);
}

.status-text {
  font-weight: 500;
}

.api-status.connected .status-text {
  color: #67c23a;
}

.api-status.disconnected .status-text {
  color: #e6a23c;
}

.status-actions {
  display: flex;
  gap: 0.75rem;
}

.admin-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.import-section {
  width: 100%;
}

.import-hint {
  margin: 0.5rem 0 0 0;
  font-size: 0.8rem;
  color: #909399;
}

.tab-content {
  min-height: 300px;
}

.form-preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.form-card,
.preview-card {
  border: none;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.article-form {
  padding: 1rem 0;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #ebeef5;
}

.preview-content {
  max-height: 400px;
  overflow-y: auto;
  padding: 1rem;
  background: #fafafa;
  border-radius: 8px;
}

.preview-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 0.85rem;
}

.preview-content.rendered {
  background: white;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: #c0c4cc;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.tag-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}

.tag-add-row {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  background: #fef0f0;
  border-radius: 8px;
  border: 1px solid #fab6b6;
}

.selection-info {
  font-size: 0.85rem;
  color: #f56c6c;
  font-weight: 500;
}

.tag-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.tag-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  background: #fafafa;
  border-radius: 10px;
  border: 1px solid #ebeef5;
  transition: all 0.3s;
  gap: 1rem;
}

.tag-item:hover {
  background: #f5f7fa;
  border-color: #dcdfe6;
}

.tag-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
}

.tag-count {
  font-size: 0.85rem;
  color: #909399;
}

.tag-actions {
  display: flex;
  gap: 0.5rem;
}

.article-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}

.article-filter {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.article-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.article-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  background: #fafafa;
  border-radius: 10px;
  border: 1px solid #ebeef5;
  transition: all 0.3s;
  gap: 1rem;
}

.article-item:hover {
  background: #f5f7fa;
  border-color: #dcdfe6;
}

.article-info {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
  min-width: 0;
}

.article-title {
  font-size: 0.95rem;
  color: #303133;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.article-date {
  font-size: 0.8rem;
  color: #c0c4cc;
}

.article-item-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.success-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.success-icon {
  font-size: 4rem;
  color: #67c23a;
}

.preview-dialog-content {
  max-height: 70vh;
  overflow-y: auto;
  padding: 1rem;
  line-height: 1.8;
}

.preview-dialog-content :deep(h1),
.preview-dialog-content :deep(h2),
.preview-dialog-content :deep(h3) {
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: #303133;
}

.preview-dialog-content :deep(p) {
  margin: 0.5rem 0;
  color: #606266;
}

.preview-dialog-content :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

.preview-dialog-content :deep(pre) {
  background: #f5f7fa;
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
}

.preview-dialog-content :deep(code) {
  background: #f7c8c8;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.85em;
}

.preview-dialog-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

@media (max-width: 900px) {
  .form-preview-grid {
    grid-template-columns: 1fr;
  }
  
  .admin-container {
    padding: 1rem;
  }
  
  .api-status {
    flex-direction: column;
    gap: 1rem;
    text-align: center;
  }
  
  .article-filter {
    flex-direction: column;
  }

  .tag-toolbar,
  .article-toolbar {
    flex-direction: column;
  }
}
</style>
