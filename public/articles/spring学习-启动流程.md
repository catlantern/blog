## 启动入口点

首先进入springboot的项目入口点

```java
@SpringBootApplication
public class SpringAnalyzeApplication {

    public static void main(String[] args)
    {
        SpringApplication.run(SpringAnalyzeApplication.class, args);
    }

}
```

断掉调试进入SpringApplication.run方法(org.springframework.boot.SpringApplication.class)：

```java
    public static ConfigurableApplicationContext run(Class<?> primarySource, String... args) {
        return run(new Class[]{primarySource}, args);
    }
```

继续跟进run方法(org.springframework.boot.SpringApplication.class)

```java
public static ConfigurableApplicationContext run(Class<?>[] primarySources, String[] args) {
    return (new SpringApplication(primarySources)).run(args);
}
```

继续跟进(org.springframework.boot.SpringApplication.class)，发现正式启动流程

```java
public ConfigurableApplicationContext run(String... args) {
    // 创建 Startup 对象，用于记录启动过程中的时间和状态信息
    Startup startup = SpringApplication.Startup.create();

    // 如果配置允许，注册关闭钩子以便在应用关闭时执行清理操作
    if (this.properties.isRegisterShutdownHook()) {
        shutdownHook.enableShutdownHookAddition();
    }

    // 创建一个引导上下文，用于传递启动时需要的信息
    DefaultBootstrapContext bootstrapContext = this.createBootstrapContext();
    ConfigurableApplicationContext context = null;

    // 配置应用的“headless”属性
    this.configureHeadlessProperty();

    // 获取应用启动过程中的监听器
    SpringApplicationRunListeners listeners = this.getRunListeners(args);

    // 通知所有监听器应用程序启动过程已经开始
    listeners.starting(bootstrapContext, this.mainApplicationClass);

    try {
        // 解析传递给应用的命令行参数
        ApplicationArguments applicationArguments = new DefaultApplicationArguments(args);

        // 准备应用的环境对象，包括加载配置文件和设置属性
        ConfigurableEnvironment environment = this.prepareEnvironment(listeners, bootstrapContext, applicationArguments);

        // 打印应用启动时的Banner
        Banner printedBanner = this.printBanner(environment);

        // 创建应用上下文对象
        context = this.createApplicationContext();

        // 设置应用启动信息
        context.setApplicationStartup(this.applicationStartup);

        // 准备应用上下文，包括注册bean和配置属性
        this.prepareContext(bootstrapContext, context, environment, listeners, applicationArguments, printedBanner);

        // 刷新应用上下文，触发所有相关的初始化过程
        this.refreshContext(context); //Bean的注册（BeanDefinition注册）发生在prepareContext()阶段，而Bean的实例化发生在refreshContext()阶段

        // 在上下文刷新后执行一些后续操作
        this.afterRefresh(context, applicationArguments);

        // 标记启动过程已完成
        startup.started();

        // 如果配置允许，记录启动信息到日志中
        if (this.properties.isLogStartupInfo()) {
            (new StartupInfoLogger(this.mainApplicationClass, environment)).logStarted(this.getApplicationLog(), startup);
        }

        // 通知监听器应用已经启动
        listeners.started(context, startup.timeTakenToStarted());

        // 执行所有 CommandLineRunner 和 ApplicationRunner
        this.callRunners(context, applicationArguments);
    } catch (Throwable ex) {
        // 处理启动过程中的异常
        throw this.handleRunFailure(context, ex, listeners);
    }

    try {
        // 如果上下文正在运行，通知监听器应用已经准备好
        if (context.isRunning()) {
            listeners.ready(context, startup.ready());
        }

        // 返回应用上下文对象
        return context;
    } catch (Throwable ex) {
        // 处理启动过程中可能的异常
        throw this.handleRunFailure(context, ex, (SpringApplicationRunListeners)null);
    }
}

```

## 分析启动对象Startup如何创建

调试 Startup startup = SpringApplication.Startup.create();进入create方法(org.springframework.boot.SpringApplication.class)

```java
        static Startup create() {
            ClassLoader classLoader = Startup.class.getClassLoader();
            return (Startup)(ClassUtils.isPresent("jdk.crac.management.CRaCMXBean", classLoader) && ClassUtils.isPresent("org.crac.management.CRaCMXBean", classLoader) ? new CoordinatedRestoreAtCheckpointStartup() : new StandardStartup());
        }
```

首先创建了一个类加载器用于在运行时检查jdk.crac.management.CRaCMXBean和org.crac.management.CRaCMXBean是否存在
如果存在创建CoordinatedRestoreAtCheckpointStartup对象，反之则创建StandardStartup对象

### 跟进StandardStartup对象(org.springframework.boot.SpringApplication.class)

```java
    private static final class StandardStartup extends Startup {
        private final Long startTime = System.currentTimeMillis();

        protected long startTime() {
            return this.startTime;
        }

        protected Long processUptime() {
            try {
                return ManagementFactory.getRuntimeMXBean().getUptime();
            } catch (Throwable var2) {
                return null;
            }
        }

        protected String action() {
            return "Started";
        }
    }
```

该类提供三个方法：

- 获取开始启动的时间
- 获取到目前为止启动的总时长
- 获取当前启动状态



### 跟进CoordinatedRestoreAtCheckpointStartup对象(org.springframework.boot.SpringApplication.class)

```java
private static final class CoordinatedRestoreAtCheckpointStartup extends Startup {
    private final StandardStartup fallback = new StandardStartup();

    protected Long processUptime() {
        long uptime = CRaCMXBean.getCRaCMXBean().getUptimeSinceRestore();
        return uptime >= 0L ? uptime : this.fallback.processUptime();
    }

    protected String action() {
        return this.restoreTime() >= 0L ? "Restored" : this.fallback.action();
    }

    private long restoreTime() {
        return CRaCMXBean.getCRaCMXBean().getRestoreTime();
    }

    protected long startTime() {
        long restoreTime = this.restoreTime();
        return restoreTime >= 0L ? restoreTime : this.fallback.startTime();
    }
}
```

该类提供4个方法 

- 获取开始启动的时间
- 获取当前启动状态
- 获取应用程序的恢复时间
- 获取恢复时间



## 分析引导上下文对象DefaultBootstrapContext如何创建（一个轻量级依赖注入容器）

首先跟进DefaultBootstrapContext bootstrapContext = this.createBootstrapContext();获取createBootstrapContext方法(org.springframework.boot.SpringApplication.class)

```java
    private DefaultBootstrapContext createBootstrapContext() {
        DefaultBootstrapContext bootstrapContext = new DefaultBootstrapContext();
        this.bootstrapRegistryInitializers.forEach((initializer) -> initializer.initialize(bootstrapContext));
        return bootstrapContext;
    }
```

继续跟进DefaultBootstrapContext对象

```java
public class DefaultBootstrapContext implements ConfigurableBootstrapContext {
    private final Map<Class<?>, BootstrapRegistry.InstanceSupplier<?>> instanceSuppliers = new HashMap();
    private final Map<Class<?>, Object> instances = new HashMap();
    private final ApplicationEventMulticaster events = new SimpleApplicationEventMulticaster();

    public <T> void register(Class<T> type, BootstrapRegistry.InstanceSupplier<T> instanceSupplier) {
        this.register(type, instanceSupplier, true);
    }

    public <T> void registerIfAbsent(Class<T> type, BootstrapRegistry.InstanceSupplier<T> instanceSupplier) {
        this.register(type, instanceSupplier, false);
    }

    private <T> void register(Class<T> type, BootstrapRegistry.InstanceSupplier<T> instanceSupplier, boolean replaceExisting) {
        Assert.notNull(type, "'type' must not be null");
        Assert.notNull(instanceSupplier, "'instanceSupplier' must not be null");
        synchronized(this.instanceSuppliers) {
            boolean alreadyRegistered = this.instanceSuppliers.containsKey(type);
            if (replaceExisting || !alreadyRegistered) {
                Assert.state(!this.instances.containsKey(type), () -> type.getName() + " has already been created");
                this.instanceSuppliers.put(type, instanceSupplier);
            }

        }
    }

    public <T> boolean isRegistered(Class<T> type) {
        synchronized(this.instanceSuppliers) {
            return this.instanceSuppliers.containsKey(type);
        }
    }

    public <T> BootstrapRegistry.InstanceSupplier<T> getRegisteredInstanceSupplier(Class<T> type) {
        synchronized(this.instanceSuppliers) {
            return (BootstrapRegistry.InstanceSupplier)this.instanceSuppliers.get(type);
        }
    }

    public void addCloseListener(ApplicationListener<BootstrapContextClosedEvent> listener) {
        this.events.addApplicationListener(listener);
    }

    public <T> T get(Class<T> type) throws IllegalStateException {
        return (T)this.getOrElseThrow(type, () -> new IllegalStateException(type.getName() + " has not been registered"));
    }

    public <T> T getOrElse(Class<T> type, T other) {
        return (T)this.getOrElseSupply(type, () -> other);
    }

    public <T> T getOrElseSupply(Class<T> type, Supplier<T> other) {
        synchronized(this.instanceSuppliers) {
            BootstrapRegistry.InstanceSupplier<?> instanceSupplier = (BootstrapRegistry.InstanceSupplier)this.instanceSuppliers.get(type);
            return (T)(instanceSupplier != null ? this.getInstance(type, instanceSupplier) : other.get());
        }
    }

    public <T, X extends Throwable> T getOrElseThrow(Class<T> type, Supplier<? extends X> exceptionSupplier) throws X {
        synchronized(this.instanceSuppliers) {
            BootstrapRegistry.InstanceSupplier<?> instanceSupplier = (BootstrapRegistry.InstanceSupplier)this.instanceSuppliers.get(type);
            if (instanceSupplier == null) {
                throw (Throwable)exceptionSupplier.get();
            } else {
                return (T)this.getInstance(type, instanceSupplier);
            }
        }
    }

    private <T> T getInstance(Class<T> type, BootstrapRegistry.InstanceSupplier<?> instanceSupplier) {
        T instance = (T)this.instances.get(type);
        if (instance == null) {
            instance = (T)instanceSupplier.get(this);
            if (instanceSupplier.getScope() == Scope.SINGLETON) {
                this.instances.put(type, instance);
            }
        }

        return instance;
    }

    public void close(ConfigurableApplicationContext applicationContext) {
        this.events.multicastEvent(new BootstrapContextClosedEvent(this, applicationContext));
    }
}
```

该类提供了以下方法：

1. **注册方法**
   - `register`：注册类型及其实例供应商，允许替换现有的注册。
   - `registerIfAbsent`：仅在类型未注册时进行注册。
2. **查询方法**
   - `isRegistered`：检查类型是否已注册。
   - `getRegisteredInstanceSupplier`：获取已注册的实例供应商。
3. **获取实例**
   - `get`：获取实例，未注册则抛异常。
   - `getOrElse`：获取实例，未注册则返回默认实例。
   - `getOrElseSupply`：获取实例，未注册则通过供应商提供默认实例。
   - `getOrElseThrow`：获取实例，未注册则抛出供应商提供的异常。
4. **事件和关闭**
   - `addCloseListener`：添加关闭事件监听器。
   - `close`：触发关闭事件，通知监听器。



## 分析监听器对象SpringApplicationRunListeners如何获取

跟进SpringApplicationRunListeners listeners = this.getRunListeners(args);

```java
    private SpringApplicationRunListeners getRunListeners(String[] args) {
        SpringFactoriesLoader.ArgumentResolver argumentResolver = ArgumentResolver.of(SpringApplication.class, this);
        argumentResolver = argumentResolver.and(String[].class, args);
        List<SpringApplicationRunListener> listeners = this.<SpringApplicationRunListener>getSpringFactoriesInstances(SpringApplicationRunListener.class, argumentResolver);
        SpringApplicationHook hook = (SpringApplicationHook)applicationHook.get();
        SpringApplicationRunListener hookListener = hook != null ? hook.getRunListener(this) : null;
        if (hookListener != null) {
            listeners = new ArrayList(listeners);
            listeners.add(hookListener);
        }

        return new SpringApplicationRunListeners(logger, listeners, this.applicationStartup);
    }
```

其中
```java
SpringFactoriesLoader.ArgumentResolver argumentResolver = ArgumentResolver.of(SpringApplication.class, this);
argumentResolver = argumentResolver.and(String[].class, args);
```

的作用是

- 创建参数解析器，用于后续实例化监听器时传递构造函数参数
- 注册两个参数：`SpringApplication` 实例和命令行参数 `args`

### 1.跟进ArgumentResolver了解参数解析器的构造

```java
    @FunctionalInterface
    public interface ArgumentResolver {
        @Nullable
        <T> T resolve(Class<T> type);

        default <T> ArgumentResolver and(Class<T> type, T value) {
            return this.and(of(type, value));
        }

        default <T> ArgumentResolver andSupplied(Class<T> type, Supplier<T> valueSupplier) {
            return this.and(ofSupplied(type, valueSupplier));
        }

        default ArgumentResolver and(ArgumentResolver argumentResolver) {
            return from((type) -> {
                Object resolved = this.resolve(type);
                return resolved != null ? resolved : argumentResolver.resolve(type);
            });
        }

        static ArgumentResolver none() {
            return from((type) -> null);
        }

        static <T> ArgumentResolver of(Class<T> type, T value) {
            return ofSupplied(type, () -> value);
        }

        static <T> ArgumentResolver ofSupplied(Class<T> type, Supplier<T> valueSupplier) {
            return from((candidateType) -> candidateType.equals(type) ? valueSupplier.get() : null);
        }

        static ArgumentResolver from(final Function<Class<?>, Object> function) {
            return new ArgumentResolver() {
                public <T> T resolve(Class<T> type) {
                    return (T)function.apply(type);
                }
            };
        }
    }
```

该接口提供了以下方法：

1。**核心解析方法**

- `resolve(Class<T> type)`：根据类型解析并返回对应的实例，如果无法解析则返回 null。

2.**组合方法**

- `and(ArgumentResolver argumentResolver)`：将当前解析器与另一个解析器组合，形成新的解析器，优先使用当前解析器的值。
- `and(Class<T> type, T value)`：将指定类型和值与当前解析器组合，创建新的组合解析器。
- `andSupplied(Class<T> type, Supplier<T> valueSupplier)`：将指定类型和值供应商与当前解析器组合，创建新的组合解析器。

3.**工厂方法**

- `of(Class<T> type, T value)`：创建一个能解析指定类型和值的解析器。
- `ofSupplied(Class<T> type, Supplier<T> valueSupplier)`：创建一个能解析指定类型并通过供应商提供值的解析器。
- `from(Function<Class<?>, Object> function)`：从函数创建参数解析器，函数定义了解析逻辑。
- `none()`：创建一个空的解析器，对所有类型都返回 null。

4.**函数式接口**

- 作为 @FunctionalInterface，可以使用 lambda 表达式直接实现 resolve 方法。

### 2.加载监听器实例

```java
List<SpringApplicationRunListener> listeners = this.<SpringApplicationRunListener>getSpringFactoriesInstances(SpringApplicationRunListener.class, argumentResolver);
```

- 从 `spring.factories` 文件中加载所有 `SpringApplicationRunListener` 的实现类
- 使用前面配置的参数解析器来实例化这些监听器

加载的监听器有

![13](/blog/articles/images/13.png)

启动过程中按顺序发挥作用：
1. AnsiOutputApplicationListener     // 配置终端输出
2. LoggingApplicationListener        // 初始化日志系统
3. EnvironmentPostProcessorApplicationListener // 处理环境配置
4. BackgroundPreinitializer          // 后台预初始化
5. FileEncodingApplicationListener   // 检查文件编码
6. ParentContextCloserApplicationListener // 上下文管理
7. ClearCachesApplicationListener    // 缓存清理（关闭时）



### 3. 处理钩子监听器

```java
SpringApplicationHook hook = (SpringApplicationHook)applicationHook.get();
SpringApplicationRunListener hookListener = hook != null ? hook.getRunListener(this) : null;
if (hookListener != null) {
    listeners = new ArrayList(listeners);
    listeners.add(hookListener);
}
```

- 检查是否有自定义的 SpringApplicationHook
- 如果有，获取其对应的运行监听器并添加到监听器列表中

### 4. 返回包装对象

```java
javareturn new SpringApplicationRunListeners(logger, listeners, this.applicationStartup);
```

- 将所有监听器包装成 `SpringApplicationRunListeners` 对象
- 这个对象会统一管理所有监听器的生命周期调用

## 发布启动事件

```
listeners.starting(bootstrapContext, this.mainApplicationClass);
```

该代码作用：**提前访问依赖**

- 在完整Spring上下文创建前就能获取组件

- 允许监听器在启动过程中注册新组件

- 基于已有组件做条件化配置

- 避免重复创建相同组件

- 启动监听器不需要直接依赖具体实现



## 核心逻辑分析

```java
            ApplicationArguments applicationArguments = new DefaultApplicationArguments(args);
            ConfigurableEnvironment environment = this.prepareEnvironment(listeners, bootstrapContext, applicationArguments);
            Banner printedBanner = this.printBanner(environment);
            context = this.createApplicationContext();
            context.setApplicationStartup(this.applicationStartup);
            this.prepareContext(bootstrapContext, context, environment, listeners, applicationArguments, printedBanner);
            this.refreshContext(context);
            this.afterRefresh(context, applicationArguments);
            startup.started();
            if (this.properties.isLogStartupInfo()) {
                (new StartupInfoLogger(this.mainApplicationClass, environment)).logStarted(this.getApplicationLog(), startup);
            }

            listeners.started(context, startup.timeTakenToStarted());
            this.callRunners(context, applicationArguments);
```

流程分析：

### 1.参数处理

```java
javaApplicationArguments applicationArguments = new DefaultApplicationArguments(args);
```

- 将main方法的命令行参数封装成ApplicationArguments对象

### 2. 环境准备

```java
javaConfigurableEnvironment environment = this.prepareEnvironment(listeners, bootstrapContext, applicationArguments);
```

- 准备应用环境（读取配置文件、设置profiles等）

### 3. 打印Banner

```java
javaBanner printedBanner = this.printBanner(environment);
```

- 打印Spring Boot启动图标

### 4. 创建应用上下文

```java
javacontext = this.createApplicationContext();
context.setApplicationStartup(this.applicationStartup);
```

- 创建Spring应用上下文（如AnnotationConfigServletWebServerApplicationContext）

### 5. 上下文准备

```java
javathis.prepareContext(bootstrapContext, context, environment, listeners, applicationArguments, printedBanner);
```

- 准备上下文：注册Bean定义、设置环境等

### 6. 刷新上下文

```java
javathis.refreshContext(context);
```

- **核心步骤**：触发Spring容器的刷新，完成Bean的创建和初始化

### 7. 后续处理

```java
javathis.afterRefresh(context, applicationArguments);
startup.started();
// 日志记录和事件发布
listeners.started(context, startup.timeTakenToStarted());
this.callRunners(context, applicationArguments);
```

## 整体流程

```
main() → SpringApplication.run() 
    ↓
创建ApplicationArguments
    ↓
准备Environment配置
    ↓
打印Banner
    ↓
创建ApplicationContext
    ↓
准备Context
    ↓
刷新Context(核心：Bean创建)
    ↓
启动完成回调
    ↓
执行Runner
    ↓
应用启动完成
```

核心逻辑的具体实现留到后续文章进行解析



## 后续处理

```java
if (context.isRunning()) {
    listeners.ready(context, startup.ready());
}

return context;
```

### 1. 状态检查

```java
javaif (context.isRunning()) {
```

- 检查应用上下文是否正在运行
- `isRunning()` 方法判断ApplicationContext是否已经启动并处于运行状态

### 2. 事件发布

```java
javalisteners.ready(context, startup.ready());
```

- 发布应用**就绪**事件
- 通知所有监听器应用已经准备就绪，可以处理请求了
- `startup.ready()` 返回应用启动完成的时间信息

### 3. 返回上下文

```java
javareturn context;
```

- 返回配置好的ApplicationContext实例
