/* @flow */

import {
  warn,
  nextTick,
  emptyObject,
  handleError,
  defineReactive,
} from "../util/index";

import { createElement } from "../vdom/create-element";
import { installRenderHelpers } from "./render-helpers/index";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { normalizeScopedSlots } from "../vdom/helpers/normalize-scoped-slots";
import VNode, { createEmptyVNode } from "../vdom/vnode";

import { isUpdatingChildComponent } from "./lifecycle";

export function initRender(vm: Component) {
  vm._vnode = null; // the root of the child tree
  vm._staticTrees = null; // v-once cached trees
  const options = vm.$options;
  const parentVnode = (vm.$vnode = options._parentVnode); // the placeholder node in parent tree
  const renderContext = parentVnode && parentVnode.context;
  //在此处，插槽将会被添加。即在render函数中，data中存在slot的vNode
  vm.$slots = resolveSlots(options._renderChildren, renderContext);
  vm.$scopedSlots = emptyObject;
  // bind the createElement fn to this instance
  // so that we get proper render context inside it.
  // args order: tag, data, children, normalizationType, alwaysNormalize
  // internal version is used by render functions compiled from templates

  //会将vm(当前实例)作为第一个参数传递给createElement函数
  vm._c = (a, b, c, d) => createElement(vm, a, b, c, d, false);
  // normalization is always applied for the public version, used in
  // user-written render functions.
  vm.$createElement = (a, b, c, d) => createElement(vm, a, b, c, d, true);

  // $attrs & $listeners are exposed for easier HOC creation.
  // they need to be reactive so that HOCs using them are always updated
  const parentData = parentVnode && parentVnode.data;

  /* istanbul ignore else */
  if (process.env.NODE_ENV !== "production") {
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$attrs is readonly.`, vm);
      },
      true
    );
    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$listeners is readonly.`, vm);
      },
      true
    );
  } else {
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      null,
      true
    );
    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      null,
      true
    );
  }
}

export let currentRenderingInstance: Component | null = null;

// for testing only
export function setCurrentRenderingInstance(vm: Component) {
  currentRenderingInstance = vm;
}

export function renderMixin(Vue: Class<Component>) {
  // install runtime convenience helpers
  installRenderHelpers(Vue.prototype);

  Vue.prototype.$nextTick = function (fn: Function) {
    return nextTick(fn, this);
  };

  //关系总结：
  //vm.$options._parentNode：当前实例在父组件中的挂载节点
  //vm.$node：与上述指向相同
  //node.parent：与上述指向相同

  Vue.prototype._render = function (): VNode {
    const vm: Component = this;
    //_parentVnode会在createComponent的时候添加，指向的自身挂载在父组件的vNode
    //本质上选项都为当前实例，而非父实例。

    //当一个子组件实例化的时候，会先将_parentVnode添加至实例的选项当中，然后经历
    //一系列的初始化操作之后，进入到mount操作，也就是当前的_render。此时，在组件
    //实例的选项($options)中，就会存在这个属性。
    //而在当前子组件实例的vnode生成之后，就会将该属性也添加到vnode的parent属性当中
    //方便在父组件patch的时候做相应的操作

    //如 _parentVnode.data.scopedSlots 其实指向的是自身的data

    //一定要时刻弄清：_parentVnode并非父节点！，它只是某个组件在父组件中的 形态。
    //_parentVNode的意思是：当前vnode是组件的源头节点。

    //如  <children :props="someProps"></children>
    //children最终为一个vNode，而他就是children组件的 _parentVNode
    const { render, _parentVnode } = vm.$options;

    if (_parentVnode) {
      //$slots在初始化选项的时候就已经初始化了。其值就为一个键为slotTarget，值为
      //children Vnode的数组的对象

      //normalizeScopedSlots其实核心就是做了这样一件事：
      //规范化$slotScopes属性的返回值；将 v-slot的scopedSlots也添加至$slots中
      vm.$scopedSlots = normalizeScopedSlots(
        _parentVnode.data.scopedSlots,
        vm.$slots,
        vm.$scopedSlots
      );
    }

    // set parent vnode. this allows render functions to have access
    // to the data on the placeholder node.
    vm.$vnode = _parentVnode;
    // render self
    let vnode;
    try {
      // There's no need to maintain a stack because all render fns are called
      // separately from one another. Nested component's render fns are called
      // when parent component is patched.
      //将此实例赋值给currentRenderingInstance,在渲染结束之后会重新置为null
      currentRenderingInstance = vm;
      //render函数的$createElement参数在此传递的
      vnode = render.call(vm._renderProxy, vm.$createElement);
    } catch (e) {
      handleError(e, vm, `render`);
      // return error render result,
      // or previous vnode to prevent render error causing blank component
      /* istanbul ignore else */
      if (process.env.NODE_ENV !== "production" && vm.$options.renderError) {
        try {
          vnode = vm.$options.renderError.call(
            vm._renderProxy,
            vm.$createElement,
            e
          );
        } catch (e) {
          handleError(e, vm, `renderError`);
          vnode = vm._vnode;
        }
      } else {
        vnode = vm._vnode;
      }
    } finally {
      currentRenderingInstance = null;
    }
    // if the returned array contains only a single node, allow it
    if (Array.isArray(vnode) && vnode.length === 1) {
      vnode = vnode[0];
    }
    // return empty vnode in case the render function errored out
    if (!(vnode instanceof VNode)) {
      //render函数只能由一个根元素
      if (process.env.NODE_ENV !== "production" && Array.isArray(vnode)) {
        warn(
          "Multiple root nodes returned from render function. Render function " +
            "should return a single root node.",
          vm
        );
      }
      vnode = createEmptyVNode();
    }
    // set parent
    //此处的parent与 options中的parent不同。这里的parent指的是 当前组件在父组件的
    //vNode 节点 。并不是指 父组件
    //将_parentVnode属性添加至当前组件的根vNode当中
    vnode.parent = _parentVnode;
    return vnode;
  };
}
