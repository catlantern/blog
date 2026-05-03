准备上下文的代码是

```java
this.prepareContext(bootstrapContext, context, environment, listeners, applicationArguments, printedBanner);
```

跟进，进入核心逻辑

```java
    private void prepareContext(DefaultBootstrapContext bootstrapContext, ConfigurableApplicationContext context, ConfigurableEnvironment environment, SpringApplicationRunListeners listeners, ApplicationArguments applicationArguments, Banner printedBanner) {
        context.setEnvironment(environment);
        this.postProcessApplicationContext(context);
        this.addAotGeneratedInitializerIfNecessary(this.initializers);
        this.applyInitializers(context);
        listeners.contextPrepared(context);
        bootstrapContext.close(context);
        if (this.properties.isLogStartupInfo()) {
            this.logStartupInfo(context.getParent() == null);
            this.logStartupInfo(context);
            this.logStartupProfileInfo(context);
        }

        ConfigurableListableBeanFactory beanFactory = context.getBeanFactory();
        beanFactory.registerSingleton("springApplicationArguments", applicationArguments);
        if (printedBanner != null) {
            beanFactory.registerSingleton("springBootBanner", printedBanner);
        }

        if (beanFactory instanceof AbstractAutowireCapableBeanFactory autowireCapableBeanFactory) {
            autowireCapableBeanFactory.setAllowCircularReferences(this.properties.isAllowCircularReferences());
            if (beanFactory instanceof DefaultListableBeanFactory listableBeanFactory) {
                listableBeanFactory.setAllowBeanDefinitionOverriding(this.properties.isAllowBeanDefinitionOverriding());
            }
        }

        if (this.properties.isLazyInitialization()) {
            context.addBeanFactoryPostProcessor(new LazyInitializationBeanFactoryPostProcessor());
        }

        if (this.properties.isKeepAlive()) {
            context.addApplicationListener(new KeepAlive());
        }

        context.addBeanFactoryPostProcessor(new PropertySourceOrderingBeanFactoryPostProcessor(context));
        if (!AotDetector.useGeneratedArtifacts()) {
            Set<Object> sources = this.getAllSources();
            Assert.state(!ObjectUtils.isEmpty(sources), "No sources defined");
            this.load(context, sources.toArray(new Object[0]));
        }

        listeners.contextLoaded(context);
    }
```

1. **设置环境配置**

```java
javacontext.setEnvironment(environment);
```

- 将之前准备好的 Environment 对象设置到上下文中
- Environment 包含配置属性、Profile 信息等

2. **后处理 ApplicationContext**

```java
javathis.postProcessApplicationContext(context);
```

- 模板方法，允许子类进行自定义后处理
- 通常用于设置 ClassLoader、BeanNameGenerator 等

3. **应用初始化器**

```java
javathis.addAotGeneratedInitializerIfNecessary(this.initializers);
this.applyInitializers(context);
```

- 添加 AOT 生成的初始化器（如果需要）
- 执行所有 ApplicationContextInitializer，允许用户自定义上下文配置

4. **事件通知**

```java
javalisteners.contextPrepared(context);
bootstrapContext.close(context);
```

- 通知监听器上下文已准备完成
- 关闭引导上下文

5. **日志信息输出**

```java
javaif (this.properties.isLogStartupInfo()) {
    this.logStartupInfo(context.getParent() == null);
    this.logStartupInfo(context);
    this.logStartupProfileInfo(context);
}
```

- 输出启动信息（版本、运行环境等）
- 输出激活的 Profile 信息

6. **注册核心单例 Bean**

```java
javaConfigurableListableBeanFactory beanFactory = context.getBeanFactory();
beanFactory.registerSingleton("springApplicationArguments", applicationArguments);
if (printedBanner != null) {
    beanFactory.registerSingleton("springBootBanner", printedBanner);
}
```

- 注册命令行参数 Bean
- 注册启动横幅 Bean

7. **配置 BeanFactory 行为**

```java
javaif (beanFactory instanceof AbstractAutowireCapableBeanFactory autowireCapableBeanFactory) {
    autowireCapableBeanFactory.setAllowCircularReferences(this.properties.isAllowCircularReferences());
    if (beanFactory instanceof DefaultListableBeanFactory listableBeanFactory) {
        listableBeanFactory.setAllowBeanDefinitionOverriding(this.properties.isAllowBeanDefinitionOverriding());
    }
}
```

- 设置是否允许循环依赖
- 设置是否允许 Bean 定义覆盖

8. **添加特殊功能处理器**

```java
javaif (this.properties.isLazyInitialization()) {
    context.addBeanFactoryPostProcessor(new LazyInitializationBeanFactoryPostProcessor());
}

if (this.properties.isKeepAlive()) {
    context.addApplicationListener(new KeepAlive());
}

context.addBeanFactoryPostProcessor(new PropertySourceOrderingBeanFactoryPostProcessor(context));
```

- 懒加载配置
- KeepAlive 监听器
- 属性源排序处理器

9. **加载应用源**

```java
javaif (!AotDetector.useGeneratedArtifacts()) {
    Set<Object> sources = this.getAllSources();
    Assert.state(!ObjectUtils.isEmpty(sources), "No sources defined");
    this.load(context, sources.toArray(new Object[0]));
}
```

- 获取所有源（主配置类、包扫描路径等）
- 加载这些源到上下文中（注册 Bean 定义）

10. **最终事件通知**

```java
javalisteners.contextLoaded(context);
```

- 通知监听器上下文已加载完成

##  整体流程

```
prepareContext()
├── 设置环境配置
├── 后处理上下文
├── 应用初始化器
├── 事件通知
├── 日志输出
├── 注册核心 Bean
├── 配置 BeanFactory 行为
├── 添加特殊处理器
├── 加载应用源
└── 最终事件通知
```