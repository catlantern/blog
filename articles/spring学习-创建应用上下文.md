spring上下文由以下代码片段创建

```java
ConfigurableApplicationContext context = null;
context = this.createApplicationContext();
```

跟进createApplicationContext方法

进入到

```java
    protected ConfigurableApplicationContext createApplicationContext() {
        return this.applicationContextFactory.create(this.properties.getWebApplicationType());
    }
```

继续跟进

```java
    public ConfigurableApplicationContext create(WebApplicationType webApplicationType) {
        try {
            return (ConfigurableApplicationContext)this.getFromSpringFactories(webApplicationType, ApplicationContextFactory::create, this::createDefaultApplicationContext);
        } catch (Exception ex) {
            throw new IllegalStateException("Unable create a default ApplicationContext instance, you may need a custom ApplicationContextFactory", ex);
        }
    }
```

继续跟进得到核心实现代码

```java
    private <T> T getFromSpringFactories(WebApplicationType webApplicationType, BiFunction<ApplicationContextFactory, WebApplicationType, T> action, Supplier<T> defaultResult) {
        for(ApplicationContextFactory candidate : SpringFactoriesLoader.loadFactories(ApplicationContextFactory.class, this.getClass().getClassLoader())) {
            T result = (T)action.apply(candidate, webApplicationType);
            if (result != null) {
                return result;
            }
        }

        return (T)(defaultResult != null ? defaultResult.get() : null);
    }
```

该函数实现流程：

1. 加载Factories

```java
SpringFactoriesLoader.loadFactories(ApplicationContextFactory.class, this.getClass().getClassLoader())
```

- 从`META-INF/spring.factories`文件中加载所有`ApplicationContextFactory`实现类
- 使用当前类的类加载器

2. 遍历执行

```java
for(ApplicationContextFactory candidate : ... ) {
    T result = (T)action.apply(candidate, webApplicationType);
    if (result != null) {
        return result;
    }
}
```

- 遍历每个加载的工厂实例
- 执行传入的`action`函数
- 如果结果不为null，立即返回（短路逻辑）

3. 默认值处理

```java
return (T)(defaultResult != null ? defaultResult.get() : null);
```

- 如果遍历完所有工厂都没有找到合适的，返回默认值



由于泛型T是ConfigurableApplicationContext，查看它的接口声明

```java
public interface ConfigurableApplicationContext extends ApplicationContext, Lifecycle, Closeable {
    String CONFIG_LOCATION_DELIMITERS = ",; \t\n";
    String BOOTSTRAP_EXECUTOR_BEAN_NAME = "bootstrapExecutor";
    String CONVERSION_SERVICE_BEAN_NAME = "conversionService";
    String LOAD_TIME_WEAVER_BEAN_NAME = "loadTimeWeaver";
    String ENVIRONMENT_BEAN_NAME = "environment";
    String SYSTEM_PROPERTIES_BEAN_NAME = "systemProperties";
    String SYSTEM_ENVIRONMENT_BEAN_NAME = "systemEnvironment";
    String APPLICATION_STARTUP_BEAN_NAME = "applicationStartup";
    String SHUTDOWN_HOOK_THREAD_NAME = "SpringContextShutdownHook";

    void setId(String id);

    void setParent(@Nullable ApplicationContext parent);

    void setEnvironment(ConfigurableEnvironment environment);

    ConfigurableEnvironment getEnvironment();

    void setApplicationStartup(ApplicationStartup applicationStartup);

    ApplicationStartup getApplicationStartup();

    void addBeanFactoryPostProcessor(BeanFactoryPostProcessor postProcessor);

    void addApplicationListener(ApplicationListener<?> listener);

    void removeApplicationListener(ApplicationListener<?> listener);

    void setClassLoader(ClassLoader classLoader);

    void addProtocolResolver(ProtocolResolver resolver);

    void refresh() throws BeansException, IllegalStateException;

    void registerShutdownHook();

    void close();

    boolean isClosed();

    boolean isActive();

    ConfigurableListableBeanFactory getBeanFactory() throws IllegalStateException;
}
```

按该接口提供了以下方法：

1.**标识和生命周期管理方法**

- `setId(String id)`：设置应用上下文的唯一标识符
- `setParent(@Nullable ApplicationContext parent)`：设置父应用上下文，形成上下文层次结构
- `registerShutdownHook()`：注册JVM关闭钩子，确保容器优雅关闭
- `close()`：关闭应用上下文，释放资源
- `isClosed()`：检查上下文是否已关闭
- `isActive()`：检查上下文是否处于活跃状态

2.**环境配置方法**

- `setEnvironment(ConfigurableEnvironment environment)`：设置可配置的环境对象
- `getEnvironment()`：获取当前的环境配置
- `setApplicationStartup(ApplicationStartup applicationStartup)`：设置应用启动跟踪器
- `getApplicationStartup()`：获取应用启动跟踪器

3. **扩展功能方法**

- `addBeanFactoryPostProcessor(BeanFactoryPostProcessor postProcessor)`：添加Bean工厂后置处理器，在Bean定义加载后、实例化前执行
- `addApplicationListener(ApplicationListener<?> listener)`：添加应用监听器，监听容器事件
- `removeApplicationListener(ApplicationListener<?> listener)`：移除指定的应用监听器
- `setClassLoader(ClassLoader classLoader)`：设置类加载器
- `addProtocolResolver(ProtocolResolver resolver)`：添加协议解析器，用于自定义资源加载

4. **核心容器操作方法**

- `refresh()`：刷新应用上下文，这是Spring容器初始化的核心方法，触发Bean的创建和初始化
- `getBeanFactory()`：获取底层的可配置Bean工厂

5. **常量定义**

- `CONFIG_LOCATION_DELIMITERS`：配置文件路径分隔符定义
- 各种标准Bean名称常量：如环境Bean、系统属性Bean、转换服务Bean等
- `SHUTDOWN_HOOK_THREAD_NAME`：关闭钩子线程名称



再查看一下这个ApllicationContext的具体实现

```java
public class AnnotationConfigServletWebServerApplicationContext extends ServletWebServerApplicationContext implements AnnotationConfigRegistry {
    private final AnnotatedBeanDefinitionReader reader;
    private final ClassPathBeanDefinitionScanner scanner;
    private final Set<Class<?>> annotatedClasses;
    private String[] basePackages;

    public AnnotationConfigServletWebServerApplicationContext() {
        this.annotatedClasses = new LinkedHashSet();
        this.reader = new AnnotatedBeanDefinitionReader(this);
        this.scanner = new ClassPathBeanDefinitionScanner(this);
    }

    public AnnotationConfigServletWebServerApplicationContext(DefaultListableBeanFactory beanFactory) {
        super(beanFactory);
        this.annotatedClasses = new LinkedHashSet();
        this.reader = new AnnotatedBeanDefinitionReader(this);
        this.scanner = new ClassPathBeanDefinitionScanner(this);
    }

    public AnnotationConfigServletWebServerApplicationContext(Class<?>... annotatedClasses) {
        this();
        this.register(annotatedClasses);
        this.refresh();
    }

    public AnnotationConfigServletWebServerApplicationContext(String... basePackages) {
        this();
        this.scan(basePackages);
        this.refresh();
    }

    public void setEnvironment(ConfigurableEnvironment environment) {
        super.setEnvironment(environment);
        this.reader.setEnvironment(environment);
        this.scanner.setEnvironment(environment);
    }

    public void setBeanNameGenerator(BeanNameGenerator beanNameGenerator) {
        this.reader.setBeanNameGenerator(beanNameGenerator);
        this.scanner.setBeanNameGenerator(beanNameGenerator);
        this.getBeanFactory().registerSingleton("org.springframework.context.annotation.internalConfigurationBeanNameGenerator", beanNameGenerator);
    }

    public void setScopeMetadataResolver(ScopeMetadataResolver scopeMetadataResolver) {
        this.reader.setScopeMetadataResolver(scopeMetadataResolver);
        this.scanner.setScopeMetadataResolver(scopeMetadataResolver);
    }

    public final void register(Class<?>... annotatedClasses) {
        Assert.notEmpty(annotatedClasses, "'annotatedClasses' must not be empty");
        this.annotatedClasses.addAll(Arrays.asList(annotatedClasses));
    }

    public final void scan(String... basePackages) {
        Assert.notEmpty(basePackages, "'basePackages' must not be empty");
        this.basePackages = basePackages;
    }

    protected void prepareRefresh() {
        this.scanner.clearCache();
        super.prepareRefresh();
    }

    protected void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        super.postProcessBeanFactory(beanFactory);
        if (this.basePackages != null && this.basePackages.length > 0) {
            this.scanner.scan(this.basePackages);
        }

        if (!this.annotatedClasses.isEmpty()) {
            this.reader.register(ClassUtils.toClassArray(this.annotatedClasses));
        }

    }
}
```

1. **核心组件**

- `AnnotatedBeanDefinitionReader reader`：注解Bean定义读取器，用于读取`@Configuration`、`@Component`等注解的类
- `ClassPathBeanDefinitionScanner scanner`：类路径Bean定义扫描器，用于扫描指定包路径下的组件
- `Set<Class<?>> annotatedClasses`：存储注册的注解配置类
- `String[] basePackages`：存储要扫描的基础包路径

2. **构造器方法**

- `AnnotationConfigServletWebServerApplicationContext()`：默认构造器，初始化读取器和扫描器
- `AnnotationConfigServletWebServerApplicationContext(DefaultListableBeanFactory beanFactory)`：指定Bean工厂的构造器
- `AnnotationConfigServletWebServerApplicationContext(Class<?>... annotatedClasses)`：直接注册配置类并刷新容器的便捷构造器
- `AnnotationConfigServletWebServerApplicationContext(String... basePackages)`：直接扫描包路径并刷新容器的便捷构造器

3. **配置注册方法**

- `register(Class<?>... annotatedClasses)`：注册配置类，但不立即处理，等到refresh时才生效
- `scan(String... basePackages)`：设置要扫描的基础包路径

4. **环境配置方法**

- `setEnvironment(ConfigurableEnvironment environment)`：设置环境配置，并同步到读取器和扫描器
- `setBeanNameGenerator(BeanNameGenerator beanNameGenerator)`：设置Bean名称生成器
- `setScopeMetadataResolver(ScopeMetadataResolver scopeMetadataResolver)`：设置作用域元数据解析器

5. **生命周期方法**

- `prepareRefresh()`：刷新前准备，清理扫描缓存
- `postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory)`：Bean工厂后处理，在此阶段执行实际的扫描和注册操作



再回到

```java
    private <T> T getFromSpringFactories(WebApplicationType webApplicationType, BiFunction<ApplicationContextFactory, WebApplicationType, T> action, Supplier<T> defaultResult) {
        for(ApplicationContextFactory candidate : SpringFactoriesLoader.loadFactories(ApplicationContextFactory.class, this.getClass().getClassLoader())) {
            T result = (T)action.apply(candidate, webApplicationType);
            if (result != null) {
                return result;
            }
        }

        return (T)(defaultResult != null ? defaultResult.get() : null);
    }
```

查看SpringFactoriesLoader.loadFactories是如何具体实现的

经过多级跳转定位到核心实现函数

```java
public <T> List<T> load(Class<T> factoryType, @Nullable ArgumentResolver argumentResolver, @Nullable FailureHandler failureHandler) {
    Assert.notNull(factoryType, "'factoryType' must not be null");
    List<String> implementationNames = this.loadFactoryNames(factoryType);
    logger.trace(LogMessage.format("Loaded [%s] names: %s", factoryType.getName(), implementationNames));
    List<T> result = new ArrayList(implementationNames.size());
    FailureHandler failureHandlerToUse = failureHandler != null ? failureHandler : THROWING_FAILURE_HANDLER;

    for(String implementationName : implementationNames) {
        T factory = (T)this.instantiateFactory(implementationName, factoryType, argumentResolver, failureHandlerToUse);
        if (factory != null) {
            result.add(factory);
        }
    }

    AnnotationAwareOrderComparator.sort(result);
    return result;
}
```

该方法提供了以下功能：

1. **参数校验**

- `Assert.notNull(factoryType, "'factoryType' must not be null")`：确保工厂类型不为null

2. **工厂名称加载**

- `List<String> implementationNames = this.loadFactoryNames(factoryType)`：从配置文件（如spring.factories）中加载指定类型的实现类全限定名列表

3. **日志记录**

- `logger.trace(...)`：记录加载的工厂名称信息，便于调试

4. **结果容器初始化**

- `List<T> result = new ArrayList(implementationNames.size())`：创建指定容量的结果列表

5. **失败处理器设置**

- `FailureHandler failureHandlerToUse = failureHandler != null ? failureHandler : THROWING_FAILURE_HANDLER`：使用传入的失败处理器，如果没有则使用默认的抛异常处理器

6. **实例化循环**

- 遍历所有实现类名称，逐个实例化：
  - `this.instantiateFactory(implementationName, factoryType, argumentResolver, failureHandlerToUse)`：使用指定参数解析器和失败处理器创建工厂实例
  - 如果实例化成功（不为null），添加到结果列表

7. **排序处理**

- `AnnotationAwareOrderComparator.sort(result)`：根据`@Order`注解或`Ordered`接口对结果进行排序

8. **返回结果**

- 返回按顺序排列的工厂实例列表





## 总结

1. **配置定义**：在 `META-INF/spring.factories` 文件中预定义各种 `ApplicationContextFactory` 实现类
2. **动态加载**：通过 `SpringFactoriesLoader` 读取配置文件，加载所有工厂类
3. **按需选择**：根据应用类型（Web、Reactive、Standard）选择合适的工厂创建上下文
4. **默认兜底**：如果没有找到合适的工厂，则使用默认实现