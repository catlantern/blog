<script setup>
import { RouterView } from 'vue-router'
import { ElHeader, ElMain, ElFooter, ElContainer } from 'element-plus'
</script>

<template>
  <el-container class="app-container">
    <el-header class="fixed-header">
        <div>我的博客</div>
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
  padding: 1.5rem 0;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  position: fixed;
  top: 0;
  width: 100%; 
  z-index: 1000;
  transition: all 0.3s;
  backdrop-filter: blur(10px);
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
  display: flex;
  justify-content: center;
  align-items: center; 
}

.fixed-header {          
  display: flex;         
  justify-content: center; 
  align-items: center;    
}


.el-main {
  padding-top: 60px; 
}

.el-footer {
  background-color: #f5f7fa;
  text-align: center;
  padding: 1rem 0;
}


.header-content p {
  margin: 0.5rem 0 0 0;
  font-size: 1rem;
  opacity: 0.9;
}

main {
  flex: 1;
  padding: 2rem 0;
  background-color: #f5f7fa;
}

footer {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  padding: 2rem 0;
  text-align: center;
  color: #4a5568;
  font-size: 0.9rem;
  transition: all 0.3s;
  border-top: 1px solid rgba(0,0,0,0.05);
}

.footer-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
}

@media (max-width: 768px) {
  .header-content h1 {
    font-size: 2rem;
  }
  
  .header-content p {
    font-size: 0.9rem;
  }
  
  .header-content, .footer-content {
    padding: 0 1rem;
  }
}
</style>
