/* @flow */

import config from "../config";
import Watcher from "../observer/watcher";
import { mark, measure } from "../util/perf";
import { createEmptyVNode } from "../vdom/vnode";
import { updateComponentListeners } from "./events";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { toggleObserving } from "../observer/index";
import { pushTarget, popTarget } from "../observer/dep";

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling,
} from "../util/index";

export let activeInstance: any = null;
export let isUpdatingChildComponent: boolean = false;

//经典高阶函数：
//首先用 prevActiveInstance闭包变量存储  在执行此组件实例化之前的实例化对象
//然后返回一个包含该 闭包变量 的对象。这样一来就实现了对prev实例的 "记忆化",
//并且 没有用到栈等空间，优化了空间复杂度
export function setActiveInstance(vm: Component) {
  const prevActiveInstance = activeInstance;
  activeInstance = vm;
  return () => {
    activeInstance = prevActiveInstance;
  };
}

export function initLifecycle(vm: Component) {
  const options = vm.$options;

  // locate first non-abstract parent
  //实例的parent属性是在componentVNodeHooks中的init方法传递的。其
  //值就为创建这个实例之时的 activeInstance(也就是当前正在解析的实例，
  //此时的子组件实例处于正在创建，还未真正创建的时刻，因此activeInstance
  //还是指父组件)。  ---关于activeInstance就在此函数的上方
  //对应的就是用到这个组件实例的 父实例。

  //如：在parent.vue 文件中：
  //<children/>
  //用到了如上 children组件。那么此时parent就为children的 $options.parent

  //在$options中，存在这样两个属性 _parentNode 和 parent
  //其中，parent就像上面说的那样，指向 父组件
  //而_parentNode 指的是 挂载在父组件的那个 节点 。 如此处就是 children 这个vNode

  //在子组件的vNode中，也会有一个parent属性，而这个parent属性，指向的就是
  //$options._parentNode。

  //！！！！！！！一定要区分 vNode和组件实例 这二者的概念

  let parent = options.parent;
  //abstract属性的作用：抽象组件。如keep-alive/transition/slot等
  //抽象组件与普通组件一样，只是它不会在界面上显示任何 DOM 元素。它们只是为现有组件添加额外的行为。
  if (parent && !options.abstract) {
    //找到祖先第一个abstract不为true的组件，将当前实例加入到此组件的$children中
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent;
    }
    parent.$children.push(vm);
  }

  vm.$parent = parent;
  vm.$root = parent ? parent.$root : vm;

  vm.$children = [];
  vm.$refs = {};

  vm._watcher = null;
  vm._inactive = null;
  vm._directInactive = false;
  vm._isMounted = false;
  vm._isDestroyed = false;
  vm._isBeingDestroyed = false;
}

export function lifecycleMixin(Vue: Class<Component>) {
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this;
    //实例指定的 el
    const prevEl = vm.$el;
    //上一次的vNode。也就是 patch需要对比的 vNode
    const prevVnode = vm._vnode;
    // 将当前正在实例化的对象设置为 activeInstance。并且支持回溯
    const restoreActiveInstance = setActiveInstance(vm);
    vm._vnode = vnode;
    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.
    if (!prevVnode) {
      // initial render
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */);
    } else {
      // updates
      vm.$el = vm.__patch__(prevVnode, vnode);
    }
    restoreActiveInstance();
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null;
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm;
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el;
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  };

  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this;
    if (vm._watcher) {
      vm._watcher.update();
    }
  };

  Vue.prototype.$destroy = function () {
    const vm: Component = this;
    if (vm._isBeingDestroyed) {
      return;
    }
    callHook(vm, "beforeDestroy");
    vm._isBeingDestroyed = true;
    // remove self from parent
    const parent = vm.$parent;
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm);
    }
    // teardown watchers
    //当前实例的Watcher
    if (vm._watcher) {
      vm._watcher.teardown();
    }
    let i = vm._watchers.length;
    // 节点、watch、computed的watch
    while (i--) {
      vm._watchers[i].teardown();
    }
    // remove reference from data ob
    // frozen object may not have observer.
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--;
    }
    // call the last hook...
    vm._isDestroyed = true;
    // invoke destroy hooks on current rendered tree
    vm.__patch__(vm._vnode, null);
    // fire destroyed hook
    callHook(vm, "destroyed");
    // turn off all instance listeners.
    vm.$off();
    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null;
    }
    // release circular reference (#6759)
    if (vm.$vnode) {
      vm.$vnode.parent = null;
    }
  };
}

//mountComponent的必须条件就是，要提供编译好(或本身就是的)render函数
//因此其本身是不具备编译能力的，编译在entry-runtime-with-compiler
export function mountComponent(
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  //如果有template的话，那么el无论是否声明，都以template的根元素为挂载点
  //虽然在此处还是挂载了声明的el，但是仅仅是为了提供给虚拟dom的patch算法用
  //最终在patch算法执行过后重新改写
  vm.$el = el;
  if (!vm.$options.render) {
    vm.$options.render = createEmptyVNode;
    if (process.env.NODE_ENV !== "production") {
      /* istanbul ignore if */
      if (
        (vm.$options.template && vm.$options.template.charAt(0) !== "#") ||
        vm.$options.el ||
        el
      ) {
        warn(
          "You are using the runtime-only build of Vue where the template " +
            "compiler is not available. Either pre-compile the templates into " +
            "render functions, or use the compiler-included build.",
          vm
        );
      } else {
        warn(
          "Failed to mount component: template or render function not defined.",
          vm
        );
      }
    }
  }
  callHook(vm, "beforeMount");

  let updateComponent;
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== "production" && config.performance && mark) {
    //包含了各种dev的额外功能，可以只关注prod的核心功能
    // updateComponent = () => {
    //   const name = vm._name;
    //   const id = vm._uid;
    //   const startTag = `vue-perf-start:${id}`;
    //   const endTag = `vue-perf-end:${id}`;
    //   mark(startTag);
    //   const vnode = vm._render();
    //   mark(endTag);
    //   measure(`vue ${name} render`, startTag, endTag);
    //   mark(startTag);
    //   vm._update(vnode, hydrating);
    //   mark(endTag);
    //   measure(`vue ${name} patch`, startTag, endTag);
    // };
  } else {
    updateComponent = () => {
      //vm._render 函数的作用是调用 vm.$options.render 函数并返回生成的虚拟节点(vnode)
      //patch函数包含在render内
      //vm._update 函数的作用是把 vm._render 函数生成的虚拟节点渲染成真正的 DOM
      vm._update(vm._render(), hydrating);
    };
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined

  //依赖的变化，通知Watcher update，从而触发updateComponent函数重新执行(patch算法在render内)
  new Watcher(
    vm,
    updateComponent,
    noop,
    {
      before() {
        if (vm._isMounted && !vm._isDestroyed) {
          callHook(vm, "beforeUpdate");
        }
      },
    },
    true /* isRenderWatcher */
  );
  hydrating = false;

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook

  //存在$vnode，则代表该组件为其他组件的子组件。则此时不需要在mount函数中调用mounted钩子
  //，而是需要在patch中调用组建的insert钩子的时候调用 mounted钩子
  if (vm.$vnode == null) {
    vm._isMounted = true;
    callHook(vm, "mounted");
  }
  //将当前实例暴露出去。
  //这也就是为什么可以直接在$mount获取当前创建的实例
  return vm;
}

//更新子组件
export function updateChildComponent(
  //当前更新的实例
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  //对应父组件中的组件节点
  parentVnode: MountedComponentVNode,
  //children，也就是组件节点的children，_c的第三个参数
  renderChildren: ?Array<VNode>
) {
  if (process.env.NODE_ENV !== "production") {
    isUpdatingChildComponent = true;
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.

  const newScopedSlots = parentVnode.data.scopedSlots;
  const oldScopedSlots = vm.$scopedSlots;

  //static scopedSlots会带有$stable属性

  //4种情况：
  //1，新的scopedSlots没有$stable
  //2，原本的scopedSlots没有$stable
  //3，二者的$key不相等
  //4，没有新的scopedSlots，原本的带有$key
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key) ||
    (!newScopedSlots && vm.$scopedSlots.$key)
  );

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.

  //new和old中任意一个存在children，或者hasDynamicScopedSlot
  const needsForceUpdate = !!(
    renderChildren || // has new static slots
    vm.$options._renderChildren || // has old static slots
    hasDynamicScopedSlot
  );

  //重新更新一次$vnode
  //在每一次patch的时候，都会根据render函数生成一个个新的vNode。虽然这些vNode可能会
  //tag相同，key相同，会对应同一个DOM节点。但是在生成的时候，其依旧是一个独立的node实例
  //因此，如果当前节点是一个组件节点，那么就需要将当前子组件实例在每一次patch之后都重新
  //刷新一次_parentNode，使其每一次patch之后都指向父组件中正确的vNode节点
  vm.$options._parentVnode = parentVnode;
  vm.$vnode = parentVnode; // update vm's placeholder node without re-render

  if (vm._vnode) {
    // update child tree's parent
    vm._vnode.parent = parentVnode;
  }
  //根据最新的vNode的children，刷新$options选项中的_renderChildren属性。
  vm.$options._renderChildren = renderChildren;

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  vm.$attrs = parentVnode.data.attrs || emptyObject;
  vm.$listeners = listeners || emptyObject;

  // update props
  //！！！！！！！！！！这里就是子组件props发生变化会实时更新的基本原理

  //propsData为父组件中传递给子组件的值。在一次刷新中，可能会发生变化，因此
  //需要刷新一次propsData，以此通知子组件改变

  //关于为什么不能以用响应式原理Watcher来更新子组件：
  //如果对于一个引用类型，且不考虑引用指针的改变，那么的确会触发Watcher更新。
  //但是如果对于基本类型，或者改变了指向的引用类型，则会导致Watcher失效。

  //其根本原因是对于一个响应式数据来说，每一个属性都对应着"两个"dep.第一个是当前
  //属性名的dep，存在于defineReactive的闭包内。而第二个只针对于此属性对应的值为
  //引用类型变量的情况。当值为引用类型时，会给这个对象也添加一个dep。

  //使用者绑定值的时候，如果绑定的是属性名，那么此属性的值无论发生什么变化，都会
  //被检测到。这就是某个组件和其选项中的data实现响应式的原理

  //但是对于子组件来说，其拿到的永远都不是某个属性，而是这个属性名对应的属性值。
  //如：
  //<children :a="a"></children>
  //此时获取到的只会是a对应的属性值，而不是a这个属性。
  //对于这种情况，如果a只是值的内部，也就是这个值对象发生变化时，子组件是能通过
  //dep通知到。但是如果是a这个属性发生了变化，如a从1变成了2，或者a的引用对象从
  //first对象变成了second对象，那么此时子组件就无法监听到了。

  //因此，为了解决这种情况，会通过子组件在父组件的组件节点的propData属性来刷新
  //子组件选项中的_props。这样也就实现了对子组件的更新

  //大家可以思考这样一个问题：若父组件给子组件传递的值没有发生变化，但是在这里不做
  //区分都统一重新赋值了，是不是代表子组件会做无意义的update？

  //其实不会。因为在每一个响应式数据定义set的时候就做了这种处理：如果oldVal === val
  //则不会做notify，也就不会通知到Watcher。

  if (propsData && vm.$options.props) {
    toggleObserving(false);
    const props = vm._props;
    const propKeys = vm.$options._propKeys || [];
    //通过子组件选项中的props属性的遍历，刷新其对应的propData。也就是更新prop
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i];
      const propOptions: any = vm.$options.props; // wtf flow?
      props[key] = validateProp(key, propOptions, propsData, vm);
    }
    toggleObserving(true);
    // keep a copy of raw propsData
    //重新赋值，更新选项中的propData属性
    vm.$options.propsData = propsData;
  }

  // update listeners
  //更新listeners属性
  listeners = listeners || emptyObject;
  //_parentListeners 即为父组件中该子组件对应的占位组件节点中的 on属性
  const oldListeners = vm.$options._parentListeners;
  vm.$options._parentListeners = listeners;
  //更新 listeners。实际上就是更新_events中的事件
  updateComponentListeners(vm, listeners, oldListeners);

  // resolve slots + force update if has children
  //如果需要，强制刷新当前子组件，实现更新
  if (needsForceUpdate) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context);
    vm.$forceUpdate();
  }

  if (process.env.NODE_ENV !== "production") {
    isUpdatingChildComponent = false;
  }
}

function isInInactiveTree(vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true;
  }
  return false;
}

export function activateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false;
    if (isInInactiveTree(vm)) {
      return;
    }
  } else if (vm._directInactive) {
    return;
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false;
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i]);
    }
    callHook(vm, "activated");
  }
}

export function deactivateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true;
    if (isInInactiveTree(vm)) {
      return;
    }
  }
  if (!vm._inactive) {
    vm._inactive = true;
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i]);
    }
    callHook(vm, "deactivated");
  }
}

export function callHook(vm: Component, hook: string) {
  // #7573 disable dep collection when invoking lifecycle hooks
  pushTarget();
  const handlers = vm.$options[hook];
  const info = `${hook} hook`;
  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm, null, vm, info);
    }
  }
  if (vm._hasHookEvent) {
    vm.$emit("hook:" + hook);
  }
  popTarget();
}
