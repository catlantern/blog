import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import BlogPost from '../views/BlogPost.vue'
import NotFound from '../views/NotFound.vue'

const routes = [
  {
    path: '/',  
    name: 'Home',
    component: Home
  },
  {
    path: '/post/:slug', 
    name: 'BlogPost',
    component: BlogPost,
    props: true
  },
  {
    path: '/:pathMatch(.*)*', 
    name: 'NotFound',
    component: NotFound
  }
]

const router = createRouter({
  history: createWebHistory('/blog/'),  
  routes
})

export default router
