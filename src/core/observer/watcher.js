/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop,
} from "../util/index";

import { traverse } from "./traverse";
import { queueWatcher } from "./scheduler";
import Dep, { pushTarget, popTarget } from "./dep";

import type { SimpleSet } from "../util/index";

let uid = 0;

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor(
    vm: Component,
    //$watcher的观察对象，或computed的get，或渲染函数的updateComponent
    expOrFn: string | Function,
    //$watcher的cb回调
    cb: Function,
    options?: ?Object,
    //是否是渲染函数的Watcher
    isRenderWatcher?: boolean
  ) {
    this.vm = vm;
    //components 的 render watcher
    if (isRenderWatcher) {
      //将renderWatcher的watcher实例赋值到vm._watcher，作为整个Vue实例的watcher；
      //computed是由其创建的时候收集在vm._computedWatcher对象中和vm._wathcers中
      //$watcher收集在vm_wathers中
      vm._watcher = this;
    }
    vm._watchers.push(this);
    // options
    if (options) {
      //是否深度依赖(否则只会依赖到data和data child 两层)
      this.deep = !!options.deep;
      //是否是开发者定义
      //user为true，则在某些会抛出报错信息；$watch强制绑定为true
      this.user = !!options.user;
      //lazy  computed的属性
      //设置了该属性，则不会初始化watch的时候就绑定依赖，而是会在第一次update的时候绑定
      this.lazy = !!options.lazy;
      //sync  同步；
      //设置了该属性，则在相关依赖下发update notify的时候，会同步执行，而不是nexttick执行
      this.sync = !!options.sync;
      //实例Watcher的 beforeUpdate
      this.before = options.before;
    } else {
      this.deep = this.user = this.lazy = this.sync = false;
    }
    //$watch的回调
    this.cb = cb;
    this.id = ++uid; // uid for batching
    //active：用来标识此Wacther实例是否处于激活状态，防止重复移除操作
    this.active = true;
    //如果lazy为true，则默认将dirty属性变为true
    this.dirty = this.lazy; // for lazy watchers
    this.deps = [];
    this.newDeps = [];
    this.depIds = new Set();
    this.newDepIds = new Set();
    this.expression =
      process.env.NODE_ENV !== "production" ? expOrFn.toString() : "";
    // parse expression for getter
    //watch一般为属性名，也可以是函数；computed就是自身的get函数
    if (typeof expOrFn === "function") {
      this.getter = expOrFn;
    } else {
      //分割字符串，历遍每一层属性
      this.getter = parsePath(expOrFn);
      if (!this.getter) {
        this.getter = noop;
        process.env.NODE_ENV !== "production" &&
          warn(
            `Failed watching path: "${expOrFn}" ` +
              "Watcher only accepts simple dot-delimited paths. " +
              "For full control, use a function instead.",
            vm
          );
      }
    }
    //如果不为lazy，则在此处就能添加上依赖
    //computed的lazy为true，代表不需要马上添加上依赖
    this.value = this.lazy ? undefined : this.get();
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  get() {
    pushTarget(this);
    //change Dep.target and subscribe depend
    let value;
    const vm = this.vm;
    try {
      //触发data的get函数，添加this为依赖
      //如果getter为函数，即expOrFn为函数，则原理一样，get了data就会添加依赖
      value = this.getter.call(vm, vm);
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`);
      } else {
        throw e;
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        //deep:true
        //deep:true无法设置Fn的情况；因为此时value为primative

        //历遍value每一个__ob__对象(get就能添加依赖)
        //如果不设置，则只能设置当前访问属性的依赖
        traverse(value);
      }
      //Dep.tatget back to null
      popTarget();

      //每一次求值之后，deps都会被清空

      //关于deps：每一次用get求值之后，首先用newDeps缓存，在每个dep实例触发target的
      //addDep的时候，会判断Watcher的newDeps和deps是否存在，如果newDeps不存在，则加
      //如newDeps，如果deps（其实就是上一次deps所存放的值）不存在，才会将watcher加入
      //相应dep实例的subs中（避免重复添加）

      //在求值完成之后，会进行cleanupDeps操作，实际上就是
      //1，清除deps中没有出现在newDeps的项（上一次存放的dep，这一次没有用到，则清理）
      //2，将newDeps的值赋给deps，并且清空newDeps，留给下一次求值备用

      //因此，出现newDeps和deps，而不是直接用deps去收集依赖的理由，是为了清楚不在依赖
      //某个dep的项
      this.cleanupDeps();
    }
    return value;
  }

  /**
   * Add a dependency to this directive.
   */
  addDep(dep: Dep) {
    const id = dep.id;
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id);
      this.newDeps.push(dep);
      if (!this.depIds.has(id)) {
        dep.addSub(this);
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps() {
    let i = this.deps.length;
    //此循环是为了移除掉被弃用的依赖
    while (i--) {
      const dep = this.deps[i];
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this);
      }
    }
    //用deps和depIds保存newDeps和newDepIds的值，然后清空newDeps和newDepIds的值
    let tmp = this.depIds;
    this.depIds = this.newDepIds;
    this.newDepIds = tmp;
    this.newDepIds.clear();
    tmp = this.deps;
    this.deps = this.newDeps;
    this.newDeps = tmp;
    this.newDeps.length = 0;
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update() {
    /* istanbul ignore else */
    //三者互不相混
    //若lazy为true(_computedWatcher),则只会在update中将dirty设置为true
    //之后由computed的get函数去执行this.evaluate
    //若是$watch，设置了sync(同步)，则会在下发通知的瞬间同步执行
    //若没有设置sync，则会在queue中等待nextTick依次执行
    if (this.lazy) {
      this.dirty = true;
    } else if (this.sync) {
      //如果设置了sync，则直接run
      this.run();
    } else {
      //如果没有设置sync，则放在queue里等待nextTick执行run
      queueWatcher(this);
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run() {
    //$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
    //如果是值引用类型的话，且get指向data，则val和oldval指向始终为同一个，无法比较出
    //属性值的改变情况
    if (this.active) {
      //get就是触发$wacther取值，或者实例的_patch和_update,或者comptued的get函数，或者
      //实例Watcher的__render 和 _update（更新和渲染）
      const value = this.get();

      //$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
      //此处会导致一个问题，如果我非引用类型对象，且设置了deep，即使value不变还是会触发回调(先设置变化的值，在设置回原本的值)
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        //如果watch函数对watch的基本类型设置了deep，则无论值是否变化，还是会触发回调
        this.deep
      ) {
        // set new value
        const oldValue = this.value;
        this.value = value;
        if (this.user) {
          const info = `callback for watcher "${this.expression}"`;
          invokeWithErrorHandling(
            this.cb,
            this.vm,
            [value, oldValue],
            this.vm,
            info
          );
        } else {
          //触发watcher的cb
          this.cb.call(this.vm, value, oldValue);
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate() {
    //在此 computed属性才第一次作为依赖添加到相关属性的get方法上
    this.value = this.get();
    this.dirty = false;
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend() {
    let i = this.deps.length;
    while (i--) {
      this.deps[i].depend();
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown() {
    //active：用来标识此Wacther实例是否处于激活状态，防止重复移除操作
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this);
      }
      let i = this.deps.length;
      while (i--) {
        this.deps[i].removeSub(this);
      }
      this.active = false;
    }
  }
}
