ApplicationContext(AppConfig)


ApplicationContext需要添加一个注解,用于配置默认AppConfig

ApplicationContext存在以下初始化属性：

- ConcurrentHashMap<String,BeanDefinition> 
- ConcurrentHashMap<String, Object>
- ArrayList<BeanPostProcessor>

bean在默认情况下是一个单例，所以要区分一个bean是否是单例还是多例，需要用到scope注解来为这个类提供一些描述信息

假如这个类是BeanDefinition，那么这个类需要具有以下属性

- 该类的类型(Class类型)
- 描述是否是单例还是多例(string类型)

Spring扫描逻辑：

- 首先扫描目标类是否具有CompoentScan注解，采用isAnnoatationPresent(注解类)方法获取
- 获取注解，采用getAnnoatation(Compoent类)，返回一个CompoentScan类
- 通过该类获取注解的值（路径），用Compoentcan.value()获取
- 新建一个类加载器，通常是ApplicationContext.class.getClassLoader'()
- 使用classLoader.getResource(路径),获取目标文件资源(一个URL类)
- 采用new File(resource.getFile())获取文件句柄
- 判断该文件句柄是否是一个目录，如果是目录，遍历目录下的文件
- 如果该文件以.class结尾，采用类加载器动态加载该类
- 接下来判断该类是否具有Component注解，
- 如果存在，判断动态加载的类是否实现了BeanPostProcessor接口(BeanPostProcessor.class.isAssignableFrom(动态加载的类)),如果实现了，新建一个该类的实例并强制转化为BeanPostProcessor类型并为beanPostProcessorList中添加该类
- 通过getAnnotation获取该动态加载的类配置的Component注解的值，获取beanName
- 然后对类名称调用一个方法，用于标准化类的名称
- 新建一个BeanDefinition类型，链式调用setType(动态加载的类)，用于配置Bean的配置信息
- 然后判断该类是否具有一个scope注解
- 如果存在，用scope中的注解的值设置目标类是单例还是多例，如果没有描述信息，默认为单例
- 然后把stirng(类名)作为key，BeanDefinition作为value,存入到一个字典当中



bean的创建逻辑

- 遍历BeanDefinitionMap的key值，获取到bean名称

- 然后获取value值，得到BeanDefinition配置信息

- 调用createBean得到Bean类型，然后在存储单例的singletonOjects字典中存入bean类

  

getBean实现逻辑(string)

- 从BeanDefinitionMap中获取目标bean名称的bean配置信息
- 然后根据bean名称获取目标bean类型
- 如果目标是单例且获取到的目标为空，转到bean的创建逻辑，如果不为空则返回目标bean类型
- 如果目标是多例，直接返回bean的创建逻辑

createBean实现逻辑(string, BeanDefinition)

- 根据传入的BeanDefinition获取目标类的类型
- 通过该类型新建一个实例
- 遍历目标类型的属性(Field),如果目标属性中含有Autowired注解，把该字段的访问权限设置为true并且为该字段使用set(instance,getBean(字段名称))将某一对象注入到该字段中
- 如果该实例实现了BeanName接口，把这个bean类强制转换成BeanName实例，并链式调用setBeanName方法
- 遍历beanPOstrProcessorList列表，调用它们的postProcessBeforeInitialization方法
- 如果该实例实现了InitializingBean接口，把这个bean类强制转换成InitializingBean实例，并链式调用afterPropertiesSet
- 遍历beanPOstrProcessorList列表，调用它们的postProcessAfterInitialization方法
- 返回该实例



Aware回调机制：

bean类需要实现一个BeanName接口，存在以下实现

- setBeanName(string)
- 



InitializingBean接口，存在以下实现:

- afterPropertiesSet(void)
- 



BeanPostProcessor接口，存在以下实现：

- object postProcessBeforeInitialization(string,object)
- object postProcessAfterInitialization(string,object)
- 



用户可以构造一个专门的xxxBeanPostProcessor用于实现BeanPostProcessor接口



AOP实现：

在postProcessAfterInitialization(string beanName,object bean)中实现，实现逻辑如下：

- 首先判断目标beanName是否是符合要求的bean名称

- 接下来使用Proxy,newInstace(BeanPostProcessor.class.getClassLoader(),bean.getClass().getInterfaces(),new InvocationHandle

  {

  @Override

  public object invoke(Object proxy, Method method ,Object[] args) throws Throwable

    {

  ​	return method.invoke(bean,args);

    }

  })方法创建一个动态代理

- 



bean的一般生命周期

UserService字段--->creatingSet<'UserService'>表示正在填充UserService字段--->无参构造方法--->普通对象--->将该普通对象添加到三级缓存singletonFactories中--->填充对象中的其他字段--->如果其他字段也填充了bean类型字段--->从单例池Map中寻找是否已经存在目标字段，如有直接返回bean对象，如果没有进入下一步--->检验creatingSet的状态,如果目标正在创建，查找earlySingletonObjects二级缓存Map,如果在该缓存中找到，直接填充该字段，如果没缓存，查找三级缓存singletonFactories，执行一个lambda表达式创建AOP代理对象,之后跳转到AOP步骤,如果不存在，执行下一步-->填充其他 属性--->postProcessBeforeInitialization(AOP)--->代理对象--->存入earlySingletonObject二级缓存--->初始化前(@PostConstruct)--->初始化(afterPropertiesSet)--->Init Method --> 初始化后(BeanPostProcessor.postProcessAfterInitialization) -->放入Map(单例池)--->creatingSet.remove<'UserService'>--->Bean对象

流程图如下：


![12](/blog/articles/images/12.png)
