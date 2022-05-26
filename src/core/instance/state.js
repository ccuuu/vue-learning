/* @flow */

import config from "../config";
import Watcher from "../observer/watcher";
import Dep, { pushTarget, popTarget } from "../observer/dep";
import { isUpdatingChildComponent } from "./lifecycle";

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving,
} from "../observer/index";

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
  invokeWithErrorHandling,
} from "../util/index";

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop,
};
//用sourceKey来代理target中的key
export function proxy(target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter() {
    return this[sourceKey][key];
    // this.myData return this._data.myData
  };
  sharedPropertyDefinition.set = function proxySetter(val) {
    this[sourceKey][key] = val;
  };
  Object.defineProperty(target, key, sharedPropertyDefinition);
}

export function initState(vm: Component) {
  vm._watchers = [];
  const opts = vm.$options;
  if (opts.props) initProps(vm, opts.props);
  if (opts.methods) initMethods(vm, opts.methods);
  if (opts.data) {
    initData(vm);
  } else {
    observe((vm._data = {}), true /* asRootData */);
  }
  if (opts.computed) initComputed(vm, opts.computed);
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch);
  }
}
//propsOptions:$options.props
function initProps(vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {};
  //_props
  const props = (vm._props = {});
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = (vm.$options._propKeys = []);
  const isRoot = !vm.$parent;
  // root instance props should be converted
  //如果不是root 组件，则取消观察
  //如果传递的值为非响应式对象，则子组件也不会为其加上observe，因此子组件不会因此对象set而刷新
  if (!isRoot) {
    toggleObserving(false);
  }
  //propsOptions === $options.props
  for (const key in propsOptions) {
    keys.push(key);
    //取出value
    //如果是default，则会加上observe
    const value = validateProp(key, propsOptions, propsData, vm);
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== "production") {
      //将驼峰转换成 abc-def-g的形式
      const hyphenatedKey = hyphenate(key);
      if (
        //如果这个key存在过
        //或者为key,ref,slot,slot-scope,is
        isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)
      ) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        );
      }
      //将key定义到_props上
      //如果此时不为root 组件，且props为非observe对象，不会给对象加上observe
      //但是 props每一个属性依旧是响应式属性。
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
              `overwritten whenever the parent component re-renders. ` +
              `Instead, use a data or computed property based on the prop's ` +
              `value. Prop being mutated: "${key}"`,
            vm
          );
        }
      });
    } else {
      //将key定义到_props上
      defineReactive(props, key, value);
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      //this.key 能访问到prop属性
      proxy(vm, `_props`, key);
    }
  }
  toggleObserving(true);
}

//vue的methods内的属性只能为function，但是events($on)和hook可以为数组
function initMethods(vm: Component, methods: Object) {
  const props = vm.$options.props;
  for (const key in methods) {
    if (process.env.NODE_ENV !== "production") {
      if (typeof methods[key] !== "function") {
        warn(
          `Method "${key}" has type "${typeof methods[
            key
          ]}" in the component definition. ` +
            `Did you reference the function correctly?`,
          vm
        );
      }
      if (props && hasOwn(props, key)) {
        warn(`Method "${key}" has already been defined as a prop.`, vm);
      }
      if (key in vm && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
            `Avoid defining component methods that start with _ or $.`
        );
      }
    }
    //在此处将所有的methods包装为bind的形式，将this永远指定为vm，因此，发布订阅模式不用再次指定this
    vm[key] =
      typeof methods[key] !== "function" ? noop : bind(methods[key], vm);
  }
}

function initData(vm: Component) {
  let data = vm.$options.data;
  data = vm._data = typeof data === "function" ? getData(data, vm) : data || {};
  if (!isPlainObject(data)) {
    data = {};
    process.env.NODE_ENV !== "production" &&
      warn(
        "data functions should return an object:\n" +
          "https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function",
        vm
      );
  }
  // proxy data on instance
  const keys = Object.keys(data);
  const props = vm.$options.props;
  const methods = vm.$options.methods;
  let i = keys.length;
  while (i--) {
    const key = keys[i];
    if (process.env.NODE_ENV !== "production") {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        );
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== "production" &&
        warn(
          `The data property "${key}" is already declared as a prop. ` +
            `Use prop default value instead.`,
          vm
        );
    } else if (!isReserved(key)) {
      // Check if a string starts with $ or _
      //代理data，即可用this.xx访问到this._data_.xx

      //如果以$ or _，无法代理到vm上，且在_init中initProxy成功，则此时会报相应的错
      proxy(vm, `_data`, key);
    }
  }
  // observe data
  observe(data, true /* asRootData */);
}

export function getData(data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget();
  try {
    return data.call(vm, vm);
  } catch (e) {
    handleError(e, vm, `data()`);
    return {};
  } finally {
    popTarget();
  }
}

const computedWatcherOptions = { lazy: true };

//在当前版本中，computed属性是将组件Watcher添加到computed depends的Subs中，因此，无论
//computed最后return 的值是否发生变化，组件Watcher都会被notify更新，只是在patch算法的
//基础上，并没有实质上更新
//在最新版本，组件的Watcher实际上会加到computed的Watcher上，并由computed的Watcher自身
//下发通知，并不是直接依赖computed watcher的depends了，并且，现在会做一层拦截，即
// newVal === oldVal(同$watch)，则不会下发通知
function initComputed(vm: Component, computed: Object) {
  // $flow-disable-line
  const watchers = (vm._computedWatchers = Object.create(null));
  // computed properties are just getters during SSR
  const isSSR = isServerRendering();

  for (const key in computed) {
    const userDef = computed[key];
    const getter = typeof userDef === "function" ? userDef : userDef.get;
    if (process.env.NODE_ENV !== "production" && getter == null) {
      warn(`Getter is missing for computed property "${key}".`, vm);
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        //callBack为noop
        noop,
        computedWatcherOptions
      );
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    if (!(key in vm)) {
      defineComputed(vm, key, userDef);
      //warn
    } else if (process.env.NODE_ENV !== "production") {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm);
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(
          `The computed property "${key}" is already defined as a prop.`,
          vm
        );
      } else if (vm.$options.methods && key in vm.$options.methods) {
        warn(
          `The computed property "${key}" is already defined as a method.`,
          vm
        );
      }
    }
  }
}

// const sharedPropertyDefinition = {
//   enumerable: true,
//   configurable: true,
//   get: noop,
//   set: noop,
// };
export function defineComputed(
  target: any,
  key: string,
  userDef: Object | Function
) {
  //如果设置了cache = false的话，只是当作一个函数执行
  const shouldCache = !isServerRendering();
  if (typeof userDef === "function") {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : createGetterInvoker(userDef);
    sharedPropertyDefinition.set = noop;
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? //是否需要缓存
        //computed缓存机制并不是比较内部的值是否变化，computed的缓存是指，如果依赖的data
        //没有发生变化，则不会触发重新计算；如果发生了变化，也只会计算一次，即使是多个地方
        //用到了此computed属性(因为dirty属性只有在updata的时候变化，在计算过之后变为false)

        //在vue最新版本中，在以上基础上更新了一层updata过滤，即在计算一次结果之后，比较
        //newVal===oldVal(同$watch) 则不会下发通知更新

        //反而，会比较依赖值的属性是$watch，它会比较newVal和oldVal是否变化(当且仅当监听的
        //属性为基本类型，且deep没有设置成false的时候)，如果 newVal === oldVal，则不会触发cb
        shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop;
    sharedPropertyDefinition.set = userDef.set || noop;
  }
  if (
    process.env.NODE_ENV !== "production" &&
    sharedPropertyDefinition.set === noop
  ) {
    sharedPropertyDefinition.set = function () {
      //computed属性必须定义了set才能操作，否则read only
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      );
    };
  }
  Object.defineProperty(target, key, sharedPropertyDefinition);
}

function createComputedGetter(key) {
  return function computedGetter() {
    //从_computedWatchers里面取出watcher实例
    const watcher = this._computedWatchers && this._computedWatchers[key];
    if (watcher) {
      // update() {
      //   if (this.lazy) {
      //     this.dirty = true;
      //   } else if (this.sync) {
      //     this.run();
      //   } else {
      //     queueWatcher(this);
      //   }
      // }
      /**
       *  evaluate() {
            this.value = this.get();
            this.dirty = false;
          }
       */
      //如果此watcher实例之前update过(依赖的data发生变化)，则会重新触发this.get()，否则将不会，返回原来的value
      //computed缓存的原理
      if (watcher.dirty) {
        //在此 computed属性才第一次作为依赖添加到相关属性的get方法上
        watcher.evaluate();
      }
      if (Dep.target) {
        //如果有target，添加下层依赖到此wather的各deps上
        // depend() {
        //   let i = this.deps.length;
        //   while (i--) {
        //     this.deps[i].depend();
        //   }
        // }
        watcher.depend();
      }
      return watcher.value;
    }
  };
}

function createGetterInvoker(fn) {
  return function computedGetter() {
    //仅仅当作函数，没有依赖，也不会因为其他属性而update
    return fn.call(this, this);
  };
}

//把options中的watch属性添加到$watch中
function initWatch(vm: Component, watch: Object) {
  for (const key in watch) {
    const handler = watch[key];
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i]);
      }
    } else {
      createWatcher(vm, key, handler);
    }
  }
}

function createWatcher(
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
  if (isPlainObject(handler)) {
    options = handler;
    handler = handler.handler;
  }
  /**
   * options:{
   *  watch:{
   *    dataA:'dataAchange'
   *  }
   * }
   */

  //handler可以为methods中的方法，会自动把属性名映射成this.methods
  if (typeof handler === "string") {
    handler = vm[handler];
  }
  return vm.$watch(expOrFn, handler, options);
}

export function stateMixin(Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {};
  dataDef.get = function () {
    return this._data;
  };
  const propsDef = {};
  propsDef.get = function () {
    return this._props;
  };
  if (process.env.NODE_ENV !== "production") {
    //can not set data and props
    dataDef.set = function () {
      warn(
        "Avoid replacing instance root $data. " +
          "Use nested data properties instead.",
        this
      );
    };
    propsDef.set = function () {
      warn(`$props is readonly.`, this);
    };
  }
  //设置了$data和$props，get返回this[_data | _props],set报错
  Object.defineProperty(Vue.prototype, "$data", dataDef);
  Object.defineProperty(Vue.prototype, "$props", propsDef);
  //$set的返回值是设置的val
  Vue.prototype.$set = set;
  //return undefined
  Vue.prototype.$delete = del;

  //把$watch添加为watcher实例，并添加到对应属性的依赖当中
  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this;
    if (isPlainObject(cb)) {
      /*
       if the second params is {
         handler(){},
         immediate:true,
         deep:true,
         flush: 'pre'/'post'/'sync'
       }, format the arguments
       */
      return createWatcher(vm, expOrFn, cb, options);
    }
    options = options || {};
    options.user = true;
    const watcher = new Watcher(vm, expOrFn, cb, options);
    if (options.immediate) {
      const info = `callback for immediate watcher "${watcher.expression}"`;
      //执行的时候不需要添加依赖，因为已经添加过了
      pushTarget();
      invokeWithErrorHandling(cb, vm, [watcher.value], vm, info);
      popTarget();
    }
    return function unwatchFn() {
      watcher.teardown();
    };
  };
}
