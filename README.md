# vue-learning
vue超详细逐行解析版源码
# 系列文章目录
` 提示：这里可以添加系列文章的所有文章的目录，目录需要自己手动添加`
例如：第一章 Python 机器学习入门之pandas的使用   

---

`提示：写完文章后，目录可以自动生成，如何生成可参考右边的帮助文档`

@[TOC](文章目录)

---

# 前言

`提示：这里可以添加本文要记录的大概内容：`

例如：随着人工智能的不断发展，机器学习这门技术也越来越重要，很多人都开启了学习机器学习，本文就介绍了机器学习的基础内容。

---

`提示：以下是本篇文章正文内容，下面案例可供参考`

# 一、pandas是什么？

示例：pandas 是基于NumPy 的一种工具，该工具是为了解决数据分析任务而创建的。

# 二、使用步骤
## 1.引入库
>代码如下（示例）：

```c
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import warnings
warnings.filterwarnings('ignore')
import  ssl
ssl._create_default_https_context = ssl._create_unverified_context
```

## 2.读入数据

代码如下（示例）：

```c
data = pd.read_csv(
    'https://labfile.oss.aliyuncs.com/courses/1283/adult.data.csv')
print(data.head())
```

该处使用的url网络请求的数据。

---

# 总结
`提示：这里对文章进行总结：`

例如：以上就是今天要讲的内容，本文仅仅简单介绍了pandas的使用，而pandas提供了大量能使我们快速便捷地处理数据的函数和方法。

