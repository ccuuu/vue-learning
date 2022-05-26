/* @flow */

import {
  tip,
  toArray,
  hyphenate,
  formatComponentName,
  invokeWithErrorHandling,
} from "../util/index";
import { updateListeners } from "../vdom/helpers/index";

export function initEvents(vm: Component) {
  vm._events = Object.create(null);
  vm._hasHookEvent = false;
  // init parent attached events
  const listeners = vm.$options._parentListeners;
  if (listeners) {
    //在此就第一次对当前组件的 listeners 进行了初始化成为_event
    updateComponentListeners(vm, listeners);
  }
}

let target: any;

function add(event, fn) {
  target.$on(event, fn);
}

function remove(event, fn) {
  target.$off(event, fn);
}

function createOnceHandler(event, fn) {
  const _target = target;
  return function onceHandler() {
    const res = fn.apply(null, arguments);
    if (res !== null) {
      _target.$off(event, onceHandler);
    }
  };
}

//将component中绑定的事件添加至自身的_event中，当$emit调用的时候，便会从中寻找

//组件节点和普通节点的区别：
//普通节点绑定的事件最终会被添加成为真实的事件。通过addEventListener实现。
//而组件节点会在createComponent的时候将所有的on事件处理为listener属性，最终
//会被处理为组件实例的_event，可以通过$emit调用。（初始化是在initEvents）

//v-on="$listeners"的原理：利用v-on将$listeners的每个函数都添加至_event中(实现的具体
//细节在generate的v-directives中)，从而实现子组件的$emit的正常调用

export function updateComponentListeners(
  vm: Component,
  listeners: Object,
  oldListeners: ?Object
) {
  target = vm;
  updateListeners(
    listeners,
    oldListeners || {},
    add,
    remove,
    createOnceHandler,
    vm
  );
  target = undefined;
}

export function eventsMixin(Vue: Class<Component>) {
  const hookRE = /^hook:/;
  Vue.prototype.$on = function (
    event: string | Array<string>,
    fn: Function
  ): Component {
    const vm: Component = this;
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$on(event[i], fn);
      }
    } else {
      //把每个event都包装成数组保存，因此其实同一个事件名可以添加多个函数
      (vm._events[event] || (vm._events[event] = [])).push(fn);
      // optimize hook:event cost by using a boolean flag marked at registration
      // instead of a hash lookup
      if (hookRE.test(event)) {
        vm._hasHookEvent = true;
      }
    }
    return vm;
  };

  Vue.prototype.$once = function (event: string, fn: Function): Component {
    const vm: Component = this;
    //利用闭包把fn放入on函数中
    function on() {
      //第一次触发的时候就解绑事件，然后再触发回调
      vm.$off(event, on);
      fn.apply(vm, arguments);
    }
    //此处是为了$off能够解绑$once
    on.fn = fn;
    vm.$on(event, on);
    return vm;
  };

  Vue.prototype.$off = function (
    event?: string | Array<string>,
    fn?: Function
  ): Component {
    const vm: Component = this;
    // all
    //如果this.$off不穿参，则移除掉所有的_event
    if (!arguments.length) {
      vm._events = Object.create(null);
      return vm;
    }
    // array of events
    //event参数可以为数组，依次解绑调所有event对应的的这个fn(fn只能为一个)
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$off(event[i], fn);
      }
      return vm;
    }
    // specific event
    const cbs = vm._events[event];
    if (!cbs) {
      return vm;
    }
    //如果不传fn，则会解绑掉事件名下对应的所有fn
    if (!fn) {
      vm._events[event] = null;
      return vm;
    }
    // specific handler
    let cb;
    let i = cbs.length;
    while (i--) {
      cb = cbs[i];
      //cb.fn === fn 是为了解绑$once的事件
      if (cb === fn || cb.fn === fn) {
        cbs.splice(i, 1);
        break;
      }
    }
    return vm;
  };

  Vue.prototype.$emit = function (event: string): Component {
    const vm: Component = this;
    //error message
    if (process.env.NODE_ENV !== "production") {
      const lowerCaseEvent = event.toLowerCase();
      if (lowerCaseEvent !== event && vm._events[lowerCaseEvent]) {
        tip(
          `Event "${lowerCaseEvent}" is emitted in component ` +
            `${formatComponentName(
              vm
            )} but the handler is registered for "${event}". ` +
            `Note that HTML attributes are case-insensitive and you cannot use ` +
            `v-on to listen to camelCase events when using in-DOM templates. ` +
            `You should probably use "${hyphenate(
              event
            )}" instead of "${event}".`
        );
      }
    }
    let cbs = vm._events[event];
    if (cbs) {
      cbs = cbs.length > 1 ? toArray(cbs) : cbs;
      //取参数；args即为$emit传过来的参数项
      const args = toArray(arguments, 1);
      const info = `event handler for "${event}"`;
      for (let i = 0, l = cbs.length; i < l; i++) {
        //res = args ? handler.apply(vm, args) : handler.call(vm)
        invokeWithErrorHandling(cbs[i], vm, args, vm, info);
      }
    }
    return vm;
  };
}
