/* @flow */

import VNode from "./vnode";
import { resolveConstructorOptions } from "core/instance/init";
import { queueActivatedComponent } from "core/observer/scheduler";
import { createFunctionalComponent } from "./create-functional-component";

import { warn, isDef, isUndef, isTrue, isObject } from "../util/index";

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData,
} from "./helpers/index";

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent,
} from "../instance/lifecycle";

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate,
} from "weex/runtime/recycle-list/render-component-template";

// inline hooks to be invoked on component VNodes during patch
const componentVNodeHooks = {
  //初始化钩子
  init(vnode: VNodeWithData, hydrating: boolean): ?boolean {
    //如果节点对应的实例已经创建，且 keepAlive
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      // kept-alive components, treat as a patch
      const mountedNode: any = vnode; // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode);
    } else {
      //创建组件实例, 也就是调用 构造函数创建该实例
      //子组件的 beforeCreate和 created就是在这里完成的
      const child = (vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance
      ));
      //挂载
      //子组件的beforeMount就是在这里完成的。而子组件的mounted不会在mounted函数中
      //就调用，而是会在insert钩子中调用
      child.$mount(hydrating ? vnode.elm : undefined, hydrating);
    }
  },

  //更新子组件的钩子
  prepatch(oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    const options = vnode.componentOptions;
    const child = (vnode.componentInstance = oldVnode.componentInstance);
    updateChildComponent(
      child,
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode

      //options.children是在componentOptions中的属性。
      //在 组件 new vNode()的时候通过第七个参数传递的。而实际上对应的就是
      //_c函数的第三个参数的children
      options.children // new children
    );
  },

  //插入钩子
  insert(vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode;
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true;
      callHook(componentInstance, "mounted");
    }
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance);
      } else {
        activateChildComponent(componentInstance, true /* direct */);
      }
    }
  },

  destroy(vnode: MountedComponentVNode) {
    const { componentInstance } = vnode;
    if (!componentInstance._isDestroyed) {
      //如果没有使用 keepAlive，则直接调用实例的 $destroy
      if (!vnode.data.keepAlive) {
        componentInstance.$destroy();
      } else {
        deactivateChildComponent(componentInstance, true /* direct */);
      }
    }
  },
};

const hooksToMerge = Object.keys(componentVNodeHooks);

export function createComponent(
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  if (isUndef(Ctor)) {
    return;
  }

  //$options中的_base即为Vue
  const baseCtor = context.$options._base;

  // plain options object: turn it into a constructor
  if (isObject(Ctor)) {
    //Ctor为一个继承了Vue的Sub构造函数
    Ctor = baseCtor.extend(Ctor);
  }

  // if at this stage it's not a constructor or an async component factory,
  // reject.
  //如果Ctor既不是对象(会转换成构造函数)，也不是function(异步加载函数)，则抛出异常
  if (typeof Ctor !== "function") {
    if (process.env.NODE_ENV !== "production") {
      warn(`Invalid Component definition: ${String(Ctor)}`, context);
    }
    return;
  }

  // async component
  let asyncFactory;
  //如果Ctor不存在cid属性，则代表其为异步函数而非构造函数
  if (isUndef(Ctor.cid)) {
    //关于异步组件：
    //在大型应用中，我们可能需要将应用分割成小一些的代码块，并且只在需要的时候才从服
    //务器加载一个模块。为了简化，Vue 允许你以一个工厂函数的方式定义你的组件，这个工
    //厂函数会异步解析你的组件定义。Vue 只有在这个组件需要被渲染的时候才会触发该工厂
    //函数，且会把结果缓存起来供未来重渲染。例如

    // Vue.component('async-example', function (resolve, reject) {
    //   setTimeout(function () {
    //     // 向 `resolve` 回调传递组件定义
    //     resolve({
    //       template: '<div>I am async!</div>'
    //     })
    //   }, 1000)
    // })

    asyncFactory = Ctor;
    //处理异步组件
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor);
    if (Ctor === undefined) {
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.

      //因为异步组件并不会立即加载完成，因此会在第一次加载的时候先生成一个placeHolder
      //而异步组件真正挂载到实例上，其实是在resolveAsyncComponent内部的resolve或
      //reject回调中调用实例的$forceUpdate实现的
      return createAsyncPlaceholder(asyncFactory, data, context, children, tag);

      // function isAsyncPlaceholder (node: VNode): boolean {
      //   return node.isComment && node.asyncFactory
      // }
    }
  }

  data = data || {};

  // resolve constructor options in case global mixins are applied after
  // component constructor creation

  //为了防止在Sub类创建之后的全局mixins导致的options改变，重新resolve一次options
  resolveConstructorOptions(Ctor);

  // transform component v-model data into props & events

  //model为generate函数中，对绑定了v-model的组件生成的相应的属性。
  if (isDef(data.model)) {
    transformModel(Ctor.options, data);
  }

  // extract props
  //本质上来说，就是用  options中的属性名，去从props或者attrs中匹配。
  //此时会默认兼容驼峰命名和连字符命名。
  //若能找到，则就会将值赋给相应的propsData。且对于attrs来说，还会删除该属性

  //这里之所以不直接放大到options中的props中，是因为还需要单独做格式校验。propsData
  //只是单纯的存放了传递的值，而props是包含type属性、require属性、default属性的对象等
  const propsData = extractPropsFromVNodeData(data, Ctor, tag);

  // functional component
  //如果选项中指明了functional属性，则创建functionalComponent
  if (isTrue(Ctor.options.functional)) {
    return createFunctionalComponent(Ctor, propsData, data, context, children);
  }

  // extract listeners, since these needs to be treated as
  // child component listeners instead of DOM listeners

  //将data中的on当作listeners属性，也就是最终$options中的listeners
  const listeners = data.on;
  // replace with listeners with .native modifier
  // so it gets processed during parent component patch.

  //将data中的nativeOn属性作为on属性
  data.on = data.nativeOn;

  //如果组件是abstract组件，则除了props，listeners，on和slot以外，不保存任何
  //其他的data属性
  if (isTrue(Ctor.options.abstract)) {
    // abstract components do not keep anything
    // other than props & listeners & slot

    // work around flow
    const slot = data.slot;
    data = {};
    if (slot) {
      data.slot = slot;
    }
  }

  // install component management hooks onto the placeholder node
  installComponentHooks(data);

  // return a placeholder vnode
  const name = Ctor.options.name || tag;
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ""}`,
    data,
    undefined,
    undefined,
    undefined,
    context,
    { Ctor, propsData, listeners, tag, children },
    asyncFactory
  );

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode);
  }

  return vnode;
}

export function createComponentInstanceForVnode(
  // we know it's MountedComponentVNode but flow doesn't
  vnode: any,
  // activeInstance in lifecycle state
  parent: any
): Component {
  const options: InternalComponentOptions = {
    //在_init中判断的_isComponent，就是在此传递的
    _isComponent: true,
    //选项中的_parentVnode为当前节点
    _parentVnode: vnode,
    //parent为父实例。子组件实例化中的parent属性，就是在这里传递的。
    parent,
  };
  // check inline-template render functions
  const inlineTemplate = vnode.data.inlineTemplate;
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render;
    options.staticRenderFns = inlineTemplate.staticRenderFns;
  }
  //调用节点实例的构造函数
  return new vnode.componentOptions.Ctor(options);
}

//初始化组件的一些钩子函数
function installComponentHooks(data: VNodeData) {
  const hooks = data.hook || (data.hook = {});
  for (let i = 0; i < hooksToMerge.length; i++) {
    //key为钩子函数名
    const key = hooksToMerge[i];
    //existing为data.hook中原本就存在的函数
    const existing = hooks[key];
    const toMerge = componentVNodeHooks[key];
    //如果hook中的函数和componentVNodeHooks中的函数不相等，并且未merge过(_merged
    //属性)，则将其合并
    if (existing !== toMerge && !(existing && existing._merged)) {
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge;
    }
  }
}

function mergeHook(f1: any, f2: any): Function {
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b);
    f2(a, b);
  };
  merged._merged = true;
  return merged;
}

// transform component v-model info (value and callback) into
// prop and event handler respectively.
function transformModel(options, data: any) {
  //默认会将model绑定为input事件
  const prop = (options.model && options.model.prop) || "value";
  const event = (options.model && options.model.event) || "input";
  (data.attrs || (data.attrs = {}))[prop] = data.model.value;
  const on = data.on || (data.on = {});
  const existing = on[event];
  const callback = data.model.callback;
  //如果事件已存在，但是没有该model的callback，则添加
  if (isDef(existing)) {
    if (
      Array.isArray(existing)
        ? existing.indexOf(callback) === -1
        : existing !== callback
    ) {
      on[event] = [callback].concat(existing);
    }
    //如果事件暂未存在，则直接new一个事件
  } else {
    on[event] = callback;
  }
}
