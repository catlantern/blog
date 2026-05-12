<script setup>
import { RouterView, RouterLink } from 'vue-router'
import { ElHeader, ElMain, ElFooter, ElContainer } from 'element-plus'
import { House } from '@element-plus/icons-vue'
</script>

<template>
  <el-container class="app-container">
    <el-header class="fixed-header">
      <div class="header-content">
        <RouterLink to="/" class="logo">
          <el-icon><House /></el-icon>
          <span>我的博客</span>
        </RouterLink>
      </div>
    </el-header>
    <el-main>
      <RouterView />
    </el-main>
    <el-footer>
      <div class="footer-content">
        <p>&copy; 2025 我的博客. </p>
      </div>
    </el-footer>
  </el-container>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.el-header {
  background: linear-gradient(135deg, #3a7bd5 0%, #00d2ff 100%);
  color: white;
  padding: 0;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  position: fixed;
  top: 0;
  width: 100%; 
  z-index: 1000;
  transition: all 0.3s;
  backdrop-filter: blur(10px);
  height: 60px;
}

.header-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 2rem;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: white;
  text-decoration: none;
  font-size: 1.3rem;
  font-weight: 600;
}

.logo:hover {
  opacity: 0.9;
}

.el-main {
  padding-top: 60px;
  overflow: visible;
}

.el-footer {
  background-color: #f5f7fa;
  text-align: center;
  padding: 0.5rem 0;
  height: auto !important;
}

footer {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  padding: 0.75rem 0;
  text-align: center;
  color: #4a5568;
  font-size: 0.85rem;
  transition: all 0.3s;
  border-top: 1px solid rgba(0,0,0,0.05);
}

.footer-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
}

@media (max-width: 768px) {
  .header-content {
    padding: 0 1rem;
  }
  
  .logo span {
    display: none;
  }
}
</style>
