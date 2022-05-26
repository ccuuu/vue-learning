# vue-learning （超详细逐行注释版vue源码）
---
#### 注意：该注释版本只保留了src目录，并且删除了很多无用文件，目的是为了查阅更加清晰方便。因此仅供学习使用。
#### 建议大家下载一份全新源码，最好是  2.6.14 版本，结合注释版本阅读。
---
### 下面是随手截的几张图：
![](https://img-blog.csdnimg.cn/1508d97692f4425591fb6f7722feaffb.png)
![](https://img-blog.csdnimg.cn/48d0cd96007e4ee4a624563d74635aa2.png)
![](https://img-blog.csdnimg.cn/0866bcaa2a31460d89b9051fd34a8de4.png)

当然，肯定不是每一个地方都如截图般详细。有些比较浅显的地方，也不需要大张旗鼓的去解释。不过重要的逻辑，我都尽量去解释清楚。

---
### 文件结构分析
#### src目录：

**compiler：** 编译相关模块，也就是template模板转换为render函数的地方；

**core：** 核心模块，vue的初始化、整个生命周期都在这里实现；

**platforms：** 平台化模块，分为web和weex，而我们只需要关注web即可；

**server：** 服务端渲染模块，我们可以无需关注；

**sfc：** 对单文件组件的处理模块。同样，无需关注；

**shared：** 一些公用的工具方法。

总结来说，在上述的文件中，我们需要重点关注的只有：compiler、core、platforms、shared。



> #### compiler文件

整个compiler的核心作用就是生成render函数。而在该模块中的重点逻辑为 HTMLParser、parse、optimization、generate。在该文件中，会存在大量的高阶函数，在阅读该模块代码的时候也是以充分学习到函数式编程的思想。以下是对几个核心文件的简单介绍：

**codengen：** 主要功能是用AST生成render函数字符串；

**directives：** 存放一些指令的处理逻辑，如v-bind、v-model、v-on等；

**parser：** 主要功能是将template模板编译为AST；

**index：** compiler的入口文件；

**optimizer：** 用来对AST做一些剪枝操作的标记处理，会在codengen和vnode的patch中用到；

**to-function：** 将codengen生成的render函数字符串用new Function的方式最终生成render函数。


> #### core文件

core模块为整个vue的核心模块，其中几乎包含了vue的所有核心内容。如vue实例化的选项合并，data、computed等属性的初始化，Watcher、Observer的实现、vue实例的挂载等等。内容很多，因此我们需要重点分析该模块：

**components：** 名称取的比较让人迷惑，但其实他并不是组件创建或更新相关的模块，在其内部只存在一个keep-alive；

**glodbal-api：** 存在一些全局api，如extend、mixin等等，也包括assets属性（component、directive）的初始化逻辑；

**instance：** core模块中的核心，也是整个vue初始化的地方。包括了各种属性、事件的初始化，以及钩子函数的调用。其中的index文件，就是vue构造函数所在。而其他的文件，就像是一个个工厂，对vue进行层层加工，即初始化参数、初始化属性和方法等等；

**observer：** 响应式的实现所在，也就是数据劫持、依赖添加的具体逻辑实现。在我之前的博客中经常说到的Watcher、Dep、Observer都存放在这个文件中；

**util：** 工具文件。各种工具函数的所在。其中nextTick函数就存放在这儿；

**vdom：** 也就是虚拟DOM（vonde）相关内容模块。包括普通节点vnode、component vnode、functional component等的初始化、patch函数等等。


> #### paltforms文件和shared文件

paltforms文件的逻辑不多，也不复杂。其中最主要的就是改写mount函数、合并一些初始化选项、做一些差异化的处理，如属性和指令等。大家可以只关注web相关的内容即可。

shared文件用来存放一些共享的工具函数（我个人最喜欢cache函数就放在这里）。

---
### 阅读流程梳理
整个vue相对而言还是比较庞大的。合适的阅读顺序能为你省下不少精力。以下是我按照个人阅读经验梳理的顺序：
![](https://img-blog.csdnimg.cn/66717120be1846a4a88762c57f51f9c8.png#pic_center)
本想整理一份尽可能详细清晰的流程图，但是似乎其中的依赖关系比想象的复杂。我尽量将主线的顺序给梳理清楚，当然肯定会有细节上的疏漏。仅作参考。

---
### 最后
由于该注释解析最初只是为个人学习所记录，并未有开源想法。因此，难免会有很多疏漏或者错别字。还请多多包涵~ 
并且整个注释是随着个人的学习阅读进行的，难免会在刚开始有理解的不全面或不到位的地方。若有感到疑惑的地方，可以随时联系我~

若存在错误，欢迎大家前来反馈，我会统一整理并更新。

我在[个人博客](https://blog.csdn.net/ccuucc?spm=1001.2101.3001.5343)上有分享vue一些核心模块的源码分析，大家可以当作参考~

祝大家学习愉快！
