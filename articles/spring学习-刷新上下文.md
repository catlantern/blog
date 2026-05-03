

由以下代码开始

```java
this.refreshContext(context);
```

跟进

```java
    private void refreshContext(ConfigurableApplicationContext context) {
        if (this.properties.isRegisterShutdownHook()) {
            shutdownHook.registerApplicationContext(context);
        }

        this.refresh(context);
    }
```

首先分析代码片段一

```java
        if (this.properties.isRegisterShutdownHook()) {
            shutdownHook.registerApplicationContext(context);
        }
```

跟进后发现

```java
    boolean isRegisterShutdownHook() {
        return this.registerShutdownHook;
    }
```

isRegisterShutdownHook用于表示是否需要注册关闭钩子，如果需要，运行registerApplicationContext方法

```java
void registerApplicationContext(ConfigurableApplicationContext context) {
        this.addRuntimeShutdownHookIfNecessary();
        synchronized(SpringApplicationShutdownHook.class) {
            this.assertNotInProgress();
            context.addApplicationListener(this.contextCloseListener);
            this.contexts.add(context);
        }
```

函数作用(注册应用上下文，为后续的清理操作做准备):

1. 添加运行时关闭钩子

```java
this.addRuntimeShutdownHookIfNecessary();
```

- **作用**：向JVM注册一个关闭钩子
- **时机**：只在第一次调用时注册一次
- **目的**：当JVM关闭时执行清理逻辑

2. 同步块保护

```java
synchronized(SpringApplicationShutdownHook.class) {
    this.assertNotInProgress();
    context.addApplicationListener(this.contextCloseListener);
    this.contexts.add(context);
}
```

同步控制

- 使用类级别的锁确保线程安全
- 防止多个线程同时修改关闭钩子状态

断言检查

```java
this.assertNotInProgress();
```

- 确保当前没有正在进行的关闭操作
- 避免在关闭过程中注册新的上下文

事件监听器注册

```java
context.addApplicationListener(this.contextCloseListener);
```

- 向应用上下文添加关闭监听器
- 当上下文关闭时会触发相应的清理逻辑

上下文存储

```java
this.contexts.add(context);
```

- 将上下文添加到内部集合中
- 便于统一管理和批量关闭



接下来分析代码片段二

```java
this.refresh(context);
```

跟进

```java
    protected void refresh(ConfigurableApplicationContext applicationContext) {
        applicationContext.refresh();
    }
```

跟进到具体实现的方法

```java
public final void refresh() throws BeansException, IllegalStateException {
    try {
        // 调用父类的 refresh 方法，执行标准的 Spring 应用上下文刷新流程
        // 包括：Bean 定义加载、Bean 创建、Aware 接口回调、InitializingBean 等
        super.refresh();
        
    } catch (RuntimeException var5) {
        // 如果刷新过程中发生异常，需要进行资源清理
        
        // 获取当前的 Web 服务器实例
        WebServer webServer = this.webServer;
        
        // 检查 Web 服务器是否存在
        if (webServer != null) {
            try {
                // 停止 Web 服务器
                webServer.stop();
                
                // 销毁 Web 服务器资源
                webServer.destroy();
                
            } catch (RuntimeException stopOrDestroyEx) {
                // 如果停止或销毁过程中也发生异常
                // 将这个异常作为被抑制的异常添加到主异常中
                // 这样可以保留所有的错误信息，便于问题排查
                var5.addSuppressed(stopOrDestroyEx);
            }
        }
        
        // 重新抛出原始异常，中断应用启动过程
        throw var5;
    }
}
```

其中调用了父类的refresh，因此先查看父类的refresh如何实现

```java
public void refresh() throws BeansException, IllegalStateException {
    // 1. 获取启动/关闭锁，确保线程安全
    this.startupShutdownLock.lock();

    try {
        // 2. 记录当前执行刷新操作的线程
        this.startupShutdownThread = Thread.currentThread();
        
        // 3. 启动性能监控步骤，记录"context.refresh"阶段开始
        StartupStep contextRefresh = this.applicationStartup.start("spring.context.refresh");
        
        // 4. 准备刷新上下文
        this.prepareRefresh();
        
        // 5. 获取新的Bean工厂实例
        ConfigurableListableBeanFactory beanFactory = this.obtainFreshBeanFactory();
        
        // 6. 配置Bean工厂的基本属性
        this.prepareBeanFactory(beanFactory);

        try {
            // 7. 允许子类对Bean工厂进行后处理
            this.postProcessBeanFactory(beanFactory);
            
            // 8. 启动Bean后处理监控步骤
            StartupStep beanPostProcess = this.applicationStartup.start("spring.context.beans.post-process");
            
            // 9. 调用所有BeanFactoryPostProcessor处理器
            this.invokeBeanFactoryPostProcessors(beanFactory);
            
            // 10. 注册所有BeanPostProcessor处理器
            this.registerBeanPostProcessors(beanFactory);
            
            // 11. 结束Bean后处理监控步骤
            beanPostProcess.end();
            
            // 12. 初始化消息源（国际化支持）
            this.initMessageSource();
            
            // 13. 初始化应用事件多播器
            this.initApplicationEventMulticaster();
            
            // 14. 模板方法，供子类特殊处理
            this.onRefresh();
            
            // 15. 注册应用监听器
            this.registerListeners();
            
            // 16. 完成Bean工厂的初始化，实例化所有非懒加载的单例Bean
            this.finishBeanFactoryInitialization(beanFactory);
            
            // 17. 完成刷新过程
            this.finishRefresh();
            
        } catch (Error | RuntimeException var12) {
            // 异常处理：记录警告日志
            if (this.logger.isWarnEnabled()) {
                this.logger.warn("Exception encountered during context initialization - cancelling refresh attempt: " + String.valueOf(var12));
            }

            // 销毁已创建的Beans
            this.destroyBeans();
            
            // 取消刷新过程
            this.cancelRefresh(var12);
            
            // 重新抛出异常
            throw var12;
        } finally {
            // 结束上下文刷新监控步骤
            contextRefresh.end();
        }
    } finally {
        // 清理工作：重置线程引用并释放锁
        this.startupShutdownThread = null;
        this.startupShutdownLock.unlock();
    }
}

```

函数作用如下：

**1. 获取启动/关闭锁，确保线程安全**

```java
this.startupShutdownLock.lock();
```

- **作用**：通过加锁机制保证在多线程环境下，同一时间只有一个线程可以执行刷新或关闭操作。
- **目的**：防止多个线程并发调用 `refresh()` 或其他生命周期方法导致状态混乱。

**2. 记录当前执行刷新操作的线程**

```java
this.startupShutdownThread = Thread.currentThread();
```

- **作用**：记录当前正在执行刷新操作的线程。
- **目的**：便于后续判断是否是刷新线程在操作，有助于调试、异常处理或中断控制。

**3. 启动性能监控步骤**

```java
StartupStep contextRefresh = this.applicationStartup.start("spring.context.refresh");
```

- **作用**：开始一个性能监控阶段，用于追踪整个上下文刷新过程的时间开销。
- **目的**：提供可观测性支持，方便开发者分析启动性能瓶颈。

4. 准备刷新上下文

```java
this.prepareRefresh();
```

- 作用:
  - 设置容器为“活跃”状态。
  - 初始化属性源（如系统属性、环境变量等）。
  - 验证必需的属性是否存在。
- **目的**：为刷新做前期准备，包括环境检查、日志记录等。

5. 获取新的 Bean 工厂实例**

```java
ConfigurableListableBeanFactory beanFactory = this.obtainFreshBeanFactory();
```

- **作用**：创建一个新的 BeanFactory 实例。
- **目的**：为后续 Bean 的注册与管理提供基础工厂对象。
- **说明**：通常由子类（如 `GenericApplicationContext`）实现该方法，返回具体的工厂实现。

**6. 配置 Bean 工厂的基本属性**

```java
this.prepareBeanFactory(beanFactory);
```

- 作用

  ：

  - 设置类加载器、表达式解析器等。
  - 添加默认的后处理器（如 `ApplicationContextAwareProcessor`）。
  - 注册默认的单例 Bean（如 `environment`, `systemProperties`, `systemEnvironment`）。

- **目的**：配置 BeanFactory 的基本运行环境，使其具备处理 Bean 的能力。

7. 允许子类对 Bean 工厂进行后处理

```java
this.postProcessBeanFactory(beanFactory);
```

- **作用**：模板方法，供子类扩展 BeanFactory。
- **目的**：允许子类在 BeanFactory 初始化完成后进一步定制（如添加额外的后处理器）。

8. 启动 Bean 后处理监控步骤

```java
StartupStep beanPostProcess = this.applicationStartup.start("spring.context.beans.post-process");
```

- **作用**：开始一个新的性能监控阶段，专门用于监控 Bean 后处理阶段。
- **目的**：细化监控粒度，帮助定位性能问题。

9. 调用所有 BeanFactoryPostProcessor 处理器

```java
this.invokeBeanFactoryPostProcessors(beanFactory);
```

- 作用

  ：

  - 执行所有实现了 `BeanFactoryPostProcessor` 接口的 Bean。
  - 可以修改 Bean 定义（如占位符替换、动态注册 Bean 等）。

- **目的**：允许开发者在 Bean 实例化前修改 BeanFactory 的定义信息。

- **10. 注册所有 BeanPostProcessor 处理器**

```java
this.registerBeanPostProcessors(beanFactory);
```

- 作用

  ：

  - 将所有实现了 `BeanPostProcessor` 接口的 Bean 注册到 BeanFactory 中。

- **目的**：这些处理器将在每个 Bean 实例化前后被调用，用于扩展 Bean 的行为（如 AOP、依赖注入等）。

11. 结束 Bean 后处理监控步骤

```java
beanPostProcess.end();
```

- **作用**：结束 Bean 后处理阶段的性能监控。
- **目的**：统计该阶段耗时，辅助性能分析。

**12. 初始化消息源（国际化支持）**

```java
this.initMessageSource();
```

- **作用**：初始化 `MessageSource`，用于国际化消息解析。
- **目的**：使应用支持多语言提示、错误信息等功能。

13. 初始化应用事件多播器

```java
this.initApplicationEventMulticaster();
```

- **作用**：初始化 `ApplicationEventMulticaster`，用于广播事件。
- **目的**：使 Spring 支持事件驱动模型，例如监听器机制。

14. 模板方法，供子类特殊处理

```java
this.onRefresh();
```

- **作用**：模板方法，供子类重写，在刷新过程中插入自定义逻辑。
- **目的**：增强扩展性，例如 Web 应用中初始化 Web 相关组件。

15. 注册应用监听器

```java
this.registerListeners();
```

- **作用**：将所有实现了 `ApplicationListener` 接口的 Bean 注册到事件多播器中。
- **目的**：使监听器能够接收并响应应用事件。

**16. 完成 Bean 工厂的初始化，实例化所有非懒加载的单例 Bean**

```java
this.finishBeanFactoryInitialization(beanFactory);
```

- 作用

  ：

  - 预实例化所有非懒加载的单例 Bean。
  - 触发 Bean 的依赖注入和初始化方法。

- **目的**：完成 Spring 容器中所有核心 Bean 的创建和初始化。

17. 完成刷新过程

```java
this.finishRefresh();
```

- 作用

  ：

  - 发布 `ContextRefreshedEvent` 事件。
  - 清理资源、更新状态。

- **目的**：通知监听器上下文已刷新完成，标志着 Spring 容器完全可用。

------

### **异常处理块**

```java
catch (Error | RuntimeException var12)
```

- 作用

  ：

  - 记录警告日志。
  - 销毁已创建的 Beans。
  - 取消刷新过程。
  - 重新抛出异常。

- **目的**：保证在刷新失败时，容器处于干净状态，并向上层抛出异常。

------

### **finally 块**

```java
finally {
    contextRefresh.end(); // 结束监控
}
finally {
    this.startupShutdownThread = null;
    this.startupShutdownLock.unlock(); // 释放锁
}
```

- 作用

  ：

  - 结束上下文刷新的性能监控。
  - 清理线程引用。
  - 解除锁，释放资源。

- **目的**：确保无论成功还是失败，都能正确清理资源。





重点观察

```java
this.onRefresh();
```

跟进后发现

```java
protected void onRefresh() {
    super.onRefresh();

    try {
        this.createWebServer();
    } catch (Throwable ex) {
        throw new ApplicationContextException("Unable to start web server", ex);
    }
}
```

调用了父类的onRefresh方法，跟进查看父类的实现

```java
    protected void onRefresh() {
        this.themeSource = UiApplicationContextUtils.initThemeSource(this);
    }
```

代码的作用是：

- **为 Web 应用初始化主题管理功能**
- **支持界面皮肤/主题的动态切换**
- **体现了 Spring Web 模块对 UI 特性的支持**
- **是 Web 应用上下文与通用应用上下文的重要区别之一**

接下来分析子类onRefresh方法的其他代码片段

```java
    try {
        this.createWebServer();
    } catch (Throwable ex) {
        throw new ApplicationContextException("Unable to start web server", ex);
    }
```

跟进createWebServer方法

```java
    private void createWebServer() {
        WebServer webServer = this.webServer;
        ServletContext servletContext = this.getServletContext();
        if (webServer == null && servletContext == null) {
            StartupStep createWebServer = this.getApplicationStartup().start("spring.boot.webserver.create");
            ServletWebServerFactory factory = this.getWebServerFactory();
            createWebServer.tag("factory", factory.getClass().toString());
            this.webServer = factory.getWebServer(new ServletContextInitializer[]{this.getSelfInitializer()});
            createWebServer.end();
            this.getBeanFactory().registerSingleton("webServerGracefulShutdown", new WebServerGracefulShutdownLifecycle(this.webServer));
            this.getBeanFactory().registerSingleton("webServerStartStop", new WebServerStartStopLifecycle(this, this.webServer));
        } else if (servletContext != null) {
            try {
                this.getSelfInitializer().onStartup(servletContext);
            } catch (ServletException ex) {
                throw new ApplicationContextException("Cannot initialize servlet context", ex);
            }
        }

        this.initPropertySources();
    }
```

该函数作用如下：

### **1. 获取当前状态**

```java
WebServer webServer = this.webServer;
ServletContext servletContext = this.getServletContext();
```

- 检查是否已有 Web 服务器实例
- 检查是否已有 Servlet 上下文

### **2. 条件判断 - 需要创建新服务器**

```java
if (webServer == null && servletContext == null) {
```

**条件含义**：既没有 Web 服务器，也没有 Servlet 上下文，说明需要创建全新的 Web 服务器。

### **3. 启动性能监控**

```java
StartupStep createWebServer = this.getApplicationStartup().start("spring.boot.webserver.create");
```

- 开始监控 Web 服务器创建过程的性能

### **4. 获取 Web 服务器工厂**

```java
ServletWebServerFactory factory = this.getWebServerFactory();
createWebServer.tag("factory", factory.getClass().toString());
```

- 从 Spring 容器中获取 Web 服务器工厂（如 TomcatServletWebServerFactory）
- 记录使用的工厂类型到监控中

### **5. 创建 Web 服务器**

```java
this.webServer = factory.getWebServer(new ServletContextInitializer[]{this.getSelfInitializer()});
```

**核心操作**：

- 调用工厂方法创建实际的 Web 服务器（Tomcat/Jetty/Undertow）
- 传入 `ServletContextInitializer` 数组用于初始化 Servlet 上下文

### **6. 结束性能监控**

```java
createWebServer.end();
```

### **7. 注册生命周期管理 Bean**

```java
this.getBeanFactory().registerSingleton("webServerGracefulShutdown", 
    new WebServerGracefulShutdownLifecycle(this.webServer));
this.getBeanFactory().registerSingleton("webServerStartStop", 
    new WebServerStartStopLifecycle(this, this.webServer));
```

**注册两个重要的生命周期管理器**：

- **优雅关闭**：应用关闭时优雅地停止 Web 服务器
- **启动停止**：管理 Web 服务器的启动和停止生命周期

### **8. 处理已有 Servlet 上下文的情况**

```java
} else if (servletContext != null) {
    try {
        this.getSelfInitializer().onStartup(servletContext);
    } catch (ServletException ex) {
        throw new ApplicationContextException("Cannot initialize servlet context", ex);
    }
}
```

**场景**：当应用运行在外部容器（如传统 Tomcat）中时，Servlet 上下文已存在，只需要初始化即可。

### **9. 初始化属性源**

```java
this.initPropertySources();
```

- 初始化与 Web 相关的属性源

## **关键概念详解**

### **ServletWebServerFactory**

```java
// 常见实现：
TomcatServletWebServerFactory
JettyServletWebServerFactory  
UndertowServletWebServerFactory
```

### **ServletContextInitializer**

```java
// 用于初始化 Servlet 上下文的回调接口
public interface ServletContextInitializer {
    void onStartup(ServletContext servletContext) throws ServletException;
}
```

### **WebServer**

```java
// 抽象的 Web 服务器接口
public interface WebServer {
    void start() throws WebServerException;
    void stop() throws WebServerException;
    int getPort();
}
```

## **执行流程图**

```
createWebServer()
├── 检查状态
│   ├── 无服务器且无上下文 → 创建新服务器
│   └── 有上下文 → 初始化现有上下文
├── 创建新服务器流程
│   ├── 启动监控
│   ├── 获取工厂
│   ├── 创建服务器
│   ├── 结束监控
│   └── 注册生命周期 Bean
└── 初始化属性源
```



重点关注

```
this.webServer = factory.getWebServer(new ServletContextInitializer[]{this.getSelfInitializer()});
```

跟进后发现

```java
    private void selfInitialize(ServletContext servletContext) throws ServletException {
        this.prepareWebApplicationContext(servletContext);
        this.registerApplicationScope(servletContext);
        WebApplicationContextUtils.registerEnvironmentBeans(this.getBeanFactory(), servletContext);

        for(ServletContextInitializer initializerBean : this.getServletContextInitializerBeans()) {
            initializerBean.onStartup(servletContext);
        }

    }
```

该方法负责将 Spring Boot 应用初始化到 Servlet 容器中:

## **方法背景**

```java
private void selfInitialize(ServletContext servletContext) throws ServletException
```

这个方法是 `ServletWebServerApplicationContext` 中的核心初始化方法，实现了 `ServletContextInitializer` 接口。

### **1. 准备 Web 应用上下文**
```java
this.prepareWebApplicationContext(servletContext);
```

#### **作用**
- 将当前的 Spring 应用上下文与 ServletContext 关联
- 设置 ServletContext 属性

#### **具体实现**
```java
protected void prepareWebApplicationContext(ServletContext servletContext) {
    // 将 Spring 应用上下文设置到 ServletContext 属性中
    servletContext.setAttribute(
        WebApplicationContext.ROOT_WEB_APPLICATION_CONTEXT_ATTRIBUTE, 
        this
    );
    
    // 设置显示名称
    servletContext.setInitParameter(
        ContextLoader.CONTEXT_ID_PARAM, 
        this.getId()
    );
}
```

#### **意义**
- 使得其他组件可以通过 `ServletContext` 获取到 Spring 应用上下文
- 符合 Servlet 规范中 Web 应用上下文的存储方式

### **2. 注册应用作用域**
```java
this.registerApplicationScope(servletContext);
```

#### **作用**
- 注册 Web 相关的作用域（request、session、application）

#### **具体实现**
```java
    private void registerApplicationScope(ServletContext servletContext) {
        ServletContextScope appScope = new ServletContextScope(servletContext);
        this.getBeanFactory().registerScope("application", appScope);
        servletContext.setAttribute(ServletContextScope.class.getName(), appScope);
    }
```

#### **意义**
```java
// 使用示例：
@Component
@RequestScope  // 每个 HTTP 请求创建一个实例
public class RequestScopedBean {
    // ...
}

@Component  
@SessionScope  // 每个 HTTP Session 创建一个实例
public class SessionScopedBean {
    // ...
}
```

### **3. 注册环境相关的 Bean**
```java
WebApplicationContextUtils.registerEnvironmentBeans(this.getBeanFactory(), servletContext);
```

#### **作用**
- 注册 Servlet 环境相关的 Bean 到 Spring 容器

#### **注册的 Bean 包括**
```java
// 主要注册以下 Bean：
- servletContext        // ServletContext 实例
- servletConfig         // ServletConfig（如果有的话）
- contextParameters     // 上下文参数
- contextAttributes     // 上下文属性
```

#### **具体实现简化版**
```java
public static void registerEnvironmentBeans(ConfigurableListableBeanFactory bf, 
                                          ServletContext servletContext) {
    if (!bf.containsBean(SERVLET_CONTEXT_BEAN_NAME)) {
        bf.registerSingleton(SERVLET_CONTEXT_BEAN_NAME, servletContext);
    }
    
    // 注册其他环境 Bean...
}
```

### **4. 执行所有 ServletContextInitializer Bean**
```java
for(ServletContextInitializer initializerBean : this.getServletContextInitializerBeans()) {
    initializerBean.onStartup(servletContext);
}
```

#### **作用**
- 获取并执行所有注册为 Bean 的 `ServletContextInitializer`

#### **获取的初始化器包括**
```java
// 主要来源：
1. @Bean 注册的 ServletContextInitializer
2. 通过 ServletRegistrationBean 注册的 Servlet
3. 通过 FilterRegistrationBean 注册的 Filter
4. 通过 ServletListenerRegistrationBean 注册的 Listener
```

## **完整的初始化流程**

```
selfInitialize(servletContext)
├── prepareWebApplicationContext()
│   ├── 关联 Spring 上下文到 ServletContext
│   └── 设置上下文属性
├── registerApplicationScope()  
│   ├── 注册 request 作用域
│   ├── 注册 session 作用域
│   └── 注册 application 作用域
├── registerEnvironmentBeans()
│   ├── 注册 servletContext Bean
│   ├── 注册 servletConfig Bean
│   └── 注册环境相关 Bean
└── getServletContextInitializerBeans().forEach()
    ├── 执行所有自定义 ServletContextInitializer
    ├── 注册 Servlet
    ├── 注册 Filter
    └── 注册 Listener
```



重点关注

```java
 initializerBean.onStartup(servletContext);
```

跟进发现

```java
public final void onStartup(ServletContext servletContext) throws ServletException {
    // 获取当前组件的描述信息（如 "servlet dispatcherServlet" 或 "filter characterEncodingFilter"）
    String description = this.getDescription();
    
    // 检查当前组件是否被启用
    if (!this.isEnabled()) {
        // 如果组件被禁用，则记录信息日志并返回，不执行注册操作
        logger.info(StringUtils.capitalize(description) + " was not registered (disabled)");
    } else {
        // 如果组件启用，则执行具体的注册逻辑
        // 这是一个模板方法，由具体的子类实现注册细节
        this.register(description, servletContext);
    }
}
```

跟进register方法

```java
    protected final void register(String description, ServletContext servletContext) {
        D registration = this.addRegistration(description, servletContext);
        if (registration == null) {
            if (this.ignoreRegistrationFailure) {
                logger.info(StringUtils.capitalize(description) + " was not registered (possibly already registered?)");
            } else {
                throw new IllegalStateException("Failed to register '%s' on the servlet context. Possibly already registered?".formatted(description));
            }
        } else {
            this.configure(registration);
        }
    }
```

跟进addRegistration方法，找到了Filter中间件的注册实现

```java
protected FilterRegistration.Dynamic addRegistration(String description, ServletContext servletContext) {
    // 1. 获取要注册的 Filter 实例
    Filter filter = this.getFilter();
    
    // 2. 获取或推断 Filter 的名称，然后执行注册
    //    addFilter() 方法来自 Servlet 3.0+ 规范
    return servletContext.addFilter(this.getOrDeduceName(filter), filter);
}
```



总结：
其余中间件也是通过

```
        for(ServletContextInitializer initializerBean : this.getServletContextInitializerBeans()) {
            initializerBean.onStartup(servletContext);
        }
```

调用onStartup方法注册相对应的中间件

 所以Filter中间件在SpringBoot中的注册流程遵循以下清晰的调用链：

  refreshContext()
    → refresh()
      → onRefresh()
        → createWebServer()
          → selfInitialize()
            → initializerBean.onStartup()
              → register()
                → addRegistration()
                  → servletContext.addFilter()

```java
1. 入口触发

  在SpringApplication.run()方法中调用refreshContext(context)开始整个上下文刷新过程。

  2. Web服务器创建

  在ServletWebServerApplicationContext.onRefresh()方法中调用createWebServer()创建Web服务器。

  3. Servlet上下文初始化

  createWebServer()方法中通过getSelfInitializer()获取初始化器，最终调用selfInitialize()方法。

  4. Filter注册执行点

  在selfInitialize()方法中，遍历所有ServletContextInitializer并调用其onStartup()方法：

  for(ServletContextInitializer initializerBean : getServletContextInitializerBeans()) {
      initializerBean.onStartup(servletContext);
  }

  5. Filter注册核心逻辑

  FilterRegistrationBean的注册流程如下：

  5.1 启用状态检查

  public final void onStartup(ServletContext servletContext) throws ServletException {
      String description = this.getDescription();
      if (!this.isEnabled()) {
          // 如果禁用则记录日志并返回
          logger.info(StringUtils.capitalize(description) + " was not registered (disabled)");
      } else {
          // 启用则执行注册
          this.register(description, servletContext);
      }
  }

  5.2 注册执行

  在register()方法中调用抽象方法addRegistration()：

  protected final void register(String description, ServletContext servletContext) {
      D registration = this.addRegistration(description, servletContext);
      if (registration == null) {
          // 处理注册失败情况
      } else {
          // 配置已注册的组件
          this.configure(registration);
      }
  }

  5.3 Filter实际注册

  在AbstractFilterRegistrationBean中实现addRegistration()方法：

  protected FilterRegistration.Dynamic addRegistration(String description, ServletContext servletContext) {
      Filter filter = this.getFilter();
      // 调用Servlet 3.0+ API将Filter注册到ServletContext
      return servletContext.addFilter(this.getOrDeduceName(filter), filter);
  }

  5.4 Filter配置

  注册后调用configure()方法配置Filter属性：

  public void configure(FilterRegistration.Dynamic registration) {
      // 设置异步支持
      registration.setAsyncSupported(this.asyncSupported);

      // 设置初始化参数
      if (!this.initParameters.isEmpty()) {
          registration.setInitParameters(this.initParameters);
      }

      // 设置URL映射和DispatcherType
      registration.addMappingForUrlPatterns(dispatcherTypes, this.matchAfter, urlPatterns);
  }
```

