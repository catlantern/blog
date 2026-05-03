

## 1. 系统异常（SystemException）

### ArgumentNullException
```csharp
// 当参数为null时抛出
public void ProcessData(string data)
{
    if (data == null)
        throw new ArgumentNullException(nameof(data));
}
```

### ArgumentException
```csharp
// 当参数无效时抛出
public void SetAge(int age)
{
    if (age < 0 || age > 150)
        throw new ArgumentException("年龄必须在0-150之间", nameof(age));
}
```

### ArgumentOutOfRangeException
```csharp
// 当参数超出有效范围时抛出
public void GetElement(int index)
{
    if (index < 0 || index >= array.Length)
        throw new ArgumentOutOfRangeException(nameof(index));
}
```

### InvalidOperationException
```csharp
// 当对象状态不允许执行操作时抛出
public class BankAccount
{
    private bool isClosed = false;
    
    public void Withdraw(decimal amount)
    {
        if (isClosed)
            throw new InvalidOperationException("账户已关闭");
    }
}
```

## 2. IO相关异常

### IOException
```csharp
// IO操作失败时抛出
try
{
    File.ReadAllText("nonexistent.txt");
}
catch (IOException ex)
{
    Console.WriteLine("文件操作失败: " + ex.Message);
}
```

### FileNotFoundException
```csharp
// 文件未找到时抛出
try
{
    var stream = new FileStream("missing.txt", FileMode.Open);
}
catch (FileNotFoundException ex)
{
    Console.WriteLine("文件未找到: " + ex.FileName);
}
```

### DirectoryNotFoundException
```csharp
// 目录未找到时抛出
try
{
    Directory.GetFiles(@"C:\NonExistentDirectory");
}
catch (DirectoryNotFoundException ex)
{
    Console.WriteLine("目录未找到: " + ex.Message);
}
```

## 3. 格式和转换异常

### FormatException
```csharp
// 格式不正确时抛出
try
{
    int number = int.Parse("abc");
}
catch (FormatException ex)
{
    Console.WriteLine("格式错误: " + ex.Message);
}
```

### InvalidCastException
```csharp
// 类型转换失败时抛出
try
{
    object obj = "hello";
    int number = (int)obj; // 抛出InvalidCastException
}
catch (InvalidCastException ex)
{
    Console.WriteLine("类型转换失败: " + ex.Message);
}
```

## 4. 算术异常

### DivideByZeroException
```csharp
// 除零操作时抛出
try
{
    int result = 10 / 0;
}
catch (DivideByZeroException ex)
{
    Console.WriteLine("除零错误: " + ex.Message);
}
```

### OverflowException
```csharp
// 算术运算溢出时抛出
try
{
    byte value = 255;
    checked
    {
        value++; // 抛出OverflowException
    }
}
catch (OverflowException ex)
{
    Console.WriteLine("溢出错误: " + ex.Message);
}
```

## 5. 集合相关异常

### IndexOutOfRangeException
```csharp
// 数组索引超出范围时抛出
try
{
    int[] array = new int[5];
    int value = array[10]; // 抛出IndexOutOfRangeException
}
catch (IndexOutOfRangeException ex)
{
    Console.WriteLine("索引超出范围: " + ex.Message);
}
```

### KeyNotFoundException
```csharp
// 字典中找不到键时抛出
try
{
    Dictionary<string, int> dict = new Dictionary<string, int>();
    int value = dict["nonexistent"]; // 抛出KeyNotFoundException
}
catch (KeyNotFoundException ex)
{
    Console.WriteLine("键未找到: " + ex.Message);
}
```

## 6. 线程和同步异常

### ThreadInterruptedException
```csharp
// 线程被中断时抛出
try
{
    Thread.Sleep(1000);
}
catch (ThreadInterruptedException ex)
{
    Console.WriteLine("线程被中断: " + ex.Message);
}
```

### TimeoutException
```csharp
// 操作超时时抛出
try
{
    // 某些超时操作
}
catch (TimeoutException ex)
{
    Console.WriteLine("操作超时: " + ex.Message);
}
```

## 7. 网络相关异常

### WebException
```csharp
// Web请求异常时抛出
try
{
    using (var client = new WebClient())
    {
        var content = client.DownloadString("http://invalid-url.com");
    }
}
catch (WebException ex)
{
    Console.WriteLine("网络请求失败: " + ex.Message);
}
```

## 8. 自定义异常

```csharp
// 自定义异常类
public class CustomBusinessException : Exception
{
    public int ErrorCode { get; }
    
    public CustomBusinessException(string message, int errorCode) 
        : base(message)
    {
        ErrorCode = errorCode;
    }
    
    public CustomBusinessException(string message, Exception innerException) 
        : base(message, innerException)
    {
    }
}

// 使用自定义异常
public void BusinessOperation()
{
    try
    {
        // 业务逻辑
        throw new CustomBusinessException("业务操作失败", 1001);
    }
    catch (CustomBusinessException ex)
    {
        Console.WriteLine($"错误码: {ex.ErrorCode}, 消息: {ex.Message}");
    }
}
```

## 异常处理最佳实践

```csharp
public void BestPracticeExample()
{
    try
    {
        // 可能抛出异常的代码
        var data = File.ReadAllText("data.txt");
        var number = int.Parse(data);
        var result = 100 / number;
    }
    catch (FileNotFoundException ex)
    {
        // 处理特定异常
        LogError("文件未找到", ex);
    }
    catch (FormatException ex)
    {
        // 处理格式异常
        LogError("数据格式错误", ex);
    }
    catch (DivideByZeroException ex)
    {
        // 处理除零异常
        LogError("除零错误", ex);
    }
    catch (Exception ex) // 捕获所有其他异常
    {
        // 记录未预期的异常
        LogError("未知错误", ex);
        throw; // 重新抛出异常
    }
    finally
    {
        // 清理资源
        Console.WriteLine("操作完成");
    }
}
```
