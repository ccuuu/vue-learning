/* @flow */

import { warn, invokeWithErrorHandling } from "core/util/index";
import { cached, isUndef, isTrue, isPlainObject } from "shared/util";

const normalizeEvent = cached(
  (
    name: string
  ): {
    name: string,
    once: boolean,
    capture: boolean,
    passive: boolean,
    handler?: Function,
    params?: Array<any>,
  } => {
    //在句法解析的时候，会将一下三个事件修饰符处理为字符串拼接的形式

    //而在此，就只是将事件的修饰符解析出来。
    const passive = name.charAt(0) === "&";
    name = passive ? name.slice(1) : name;
    const once = name.charAt(0) === "~"; // Prefixed last, checked first
    name = once ? name.slice(1) : name;
    const capture = name.charAt(0) === "!";
    name = capture ? name.slice(1) : name;
    return {
      name,
      once,
      capture,
      passive,
    };
  }
);

export function createFnInvoker(
  fns: Function | Array<Function>,
  vm: ?Component
): Function {
  function invoker() {
    const fns = invoker.fns;
    if (Array.isArray(fns)) {
      const cloned = fns.slice();
      for (let i = 0; i < cloned.length; i++) {
        //调用
        invokeWithErrorHandling(cloned[i], null, arguments, vm, `v-on handler`);
      }
    } else {
      // return handler return value for single handlers
      return invokeWithErrorHandling(fns, null, arguments, vm, `v-on handler`);
    }
  }
  //给创建的invoker函数绑定上fns属性，指向即为原始的on中对应的回调函数
  invoker.fns = fns;
  return invoker;
}

//该函数的作用，：
//1，就是将之前句法分析中对once，capture，passive的处理给解析回事件当中。
//   然后根据这些属性的不同，做区别的添加处理。
//2，一并处理了一个回调和多个回调的场景(统一包装一个invoker函数)
//3，对于old和new做处理

export function updateListeners(
  on: Object,
  oldOn: Object,
  add: Function,
  remove: Function,
  createOnceHandler: Function,
  vm: Component
) {
  let name, def, cur, old, event;
  for (name in on) {
    def = cur = on[name];
    old = oldOn[name];
    event = normalizeEvent(name);
    /* istanbul ignore if */
    if (__WEEX__ && isPlainObject(def)) {
      cur = def.handler;
      event.params = def.params;
    }
    if (isUndef(cur)) {
      //如果事件回调为undefined，则报错
      process.env.NODE_ENV !== "production" &&
        warn(
          `Invalid handler for event "${event.name}": got ` + String(cur),
          vm
        );
      //如果old为undefined，则直接添加
    } else if (isUndef(old)) {
      //fns就是在createFnInvoker中添加的。
      if (isUndef(cur.fns)) {
        //将on中的属性重新包装。即创建了一个会调用原本定义的回调的invoker函数
        //目的是为了统一处理一个回调和多个回调的两种情况
        cur = on[name] = createFnInvoker(cur, vm);
      }
      if (isTrue(event.once)) {
        //如果once属性为true，则创建onceHandler
        cur = on[name] = createOnceHandler(event.name, cur, event.capture);
      }
      add(event.name, cur, event.capture, event.passive, event.params);
      //如果old和new都存在，但是二者不相等
    } else if (cur !== old) {
      //将old的fns指向cur

      //！！！！！！！！！！！！！！！！！！！！！！！！！！！！！
      //这是一个极其优雅的写法。正常情况下，当事件回调需要发生改变，我们的做法
      //是removeEventListener之前的事件，然后重新addEventListener新的回调
      //而vue的这种写法，可以避免移除的这一步，直接通过改变函数的某个属性从而
      //实现事件的更新。
      old.fns = cur;
      on[name] = old;
    }
  }
  //历遍old事件，如果在new事件中没有，则移除该事件
  for (name in oldOn) {
    if (isUndef(on[name])) {
      event = normalizeEvent(name);
      remove(event.name, oldOn[name], event.capture);
    }
  }
}
