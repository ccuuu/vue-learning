/* @flow */

import config from "../config";
import { initProxy } from "./proxy";
import { initState } from "./state";
import { initRender } from "./render";
import { initEvents } from "./events";
import { mark, measure } from "../util/perf";
import { initLifecycle, callHook } from "./lifecycle";
import { initProvide, initInjections } from "./inject";
import { extend, mergeOptions, formatComponentName } from "../util/index";

let uid = 0;

export function initMixin(Vue: Class<Component>) {
  //new Vue(options)
  //Vue.extemd(options)
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this;
    // a uid
    vm._uid = uid++;

    let startTag, endTag;
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`;
      endTag = `vue-perf-end:${vm._uid}`;
      mark(startTag);
    }

    // a flag to avoid this being observed
    vm._isVue = true;
    // merge options
    if (options && options._isComponent) {
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      initInternalComponent(vm, options);
    } else {
      vm.$options = mergeOptions(
        //取出vue的constructor上的options
        //在Global-api中初始化
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      );
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== "production") {
      //代理vm属性的has和get
      //has：如果访问的属性不在实例上，且!isAllow，则返回false
      //代理config.keyCodes的set（用户自定义按键修饰符号）
      initProxy(vm);
    } else {
      vm._renderProxy = vm;
    }
    // expose real self
    vm._self = vm;

    /** initLifecycle :
     *  vm.$parent = parent;
        vm.$root = parent ? parent.$root : vm;

        vm.$children = [];
        vm.$refs = {};

        vm._watcher = null;
        vm._inactive = null;
        vm._directInactive = false;
        vm._isMounted = false;
        vm._isDestroyed = false;
        vm._isBeingDestroyed = false;
     */
    initLifecycle(vm);
    /**
     * vm._events = Object.create(null)
       vm._hasHookEvent = false
     */
    initEvents(vm);
    //init vm.$slots and vm.$scopedSlots
    //vm._c = vm.$createElement = createElement
    //defineReactive for $attrs and $listeners
    initRender(vm);
    callHook(vm, "beforeCreate");
    //初始化inject
    initInjections(vm); // resolve injections before data/props
    //初始化Vue options中的 props,methods,data,computed,watch, 并为每一项添加依赖
    /**
     * init props
     * init methods
     * init data
     * init computed
     * init watch
     */
    initState(vm);
    //vm._provided = typeof provide === "function" ? provide.call(vm) : provide;
    initProvide(vm); // resolve provide after data/props
    callHook(vm, "created");

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && config.performance && mark) {
      vm._name = formatComponentName(vm, false);
      mark(endTag);
      measure(`vue ${vm._name} init`, startTag, endTag);
    }

    //如果选项中存在el属性，则会直接在init的时候就调用$mount。如果不存在，则需要手动
    //调用。
    //比如子组件初始化的时候，就需要手动调用$mount方法
    if (vm.$options.el) {
      //挂载
      //调用mountComponent和compiler
      //在$mount函数内部，存在两个主要的函数，mountComponent和compiler
      //compiler负责执行编译，将模板编译成render，mountComponent负责生成AST和挂载，将
      //compiler函数编译好的render解析成AST，在将AST挂载到真实的DOM树上
      //在mountComponent中，会将vm的update创建为Watcher，在此基础上call hook beforeMount和mounted
      vm.$mount(vm.$options.el);
    }
  };
}

export function initInternalComponent(
  vm: Component,
  options: InternalComponentOptions
) {
  const opts = (vm.$options = Object.create(vm.constructor.options));
  // doing this because it's faster than dynamic enumeration.
  const parentVnode = options._parentVnode;
  opts.parent = options.parent;
  opts._parentVnode = parentVnode;

  const vnodeComponentOptions = parentVnode.componentOptions;
  //以下属性皆是在createComponent中初始化。
  opts.propsData = vnodeComponentOptions.propsData;
  //listeners：对应的就是组件节点绑定的事件
  opts._parentListeners = vnodeComponentOptions.listeners;
  opts._renderChildren = vnodeComponentOptions.children;
  opts._componentTag = vnodeComponentOptions.tag;

  if (options.render) {
    opts.render = options.render;
    opts.staticRenderFns = options.staticRenderFns;
  }
}

export function resolveConstructorOptions(Ctor: Class<Component>) {
  let options = Ctor.options;
  //当前vm为Sub，即Vue.extend对象
  if (Ctor.super) {
    const superOptions = resolveConstructorOptions(Ctor.super);
    // Sub.superOptions = Super.options;
    const cachedSuperOptions = Ctor.superOptions;
    //如果父类的options发生了改变，则重新赋值
    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      //重新将super的options传递给child.constructor.superOptions
      Ctor.superOptions = superOptions;
      // check if there are any late-modified/attached options (#4976)
      //是否有后期修改或者附加的options
      const modifiedOptions = resolveModifiedOptions(Ctor);
      // update base extend options
      //若有，则将其添加至extendOptions中
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions);
      }
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions);
      if (options.name) {
        options.components[options.name] = Ctor;
      }
    }
  }
  return options;
}

function resolveModifiedOptions(Ctor: Class<Component>): ?Object {
  let modified;
  const latest = Ctor.options;
  const sealed = Ctor.sealedOptions;
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {};
      modified[key] = latest[key];
    }
  }
  return modified;
}
