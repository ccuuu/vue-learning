/* @flow */
/* globals MutationObserver */

import { noop } from "shared/util";
import { handleError } from "./error";
import { isIE, isIOS, isNative } from "./env";

//isUsingMicroTask 使用的是否是微任务回调。如果使用了宏任务的模式，则该变量为false
export let isUsingMicroTask = false;

const callbacks = [];
let pending = false;

//flushCallBacks并不会关注回调执行状态，它只需要调用即可，因此flushCallBacks
//几乎是瞬间执行完毕的，但是也会出现微任务队列中存在两个flushCallBacks的情况

//不过，callacks会在flushCallBacks执行的瞬间清空，因此，即使在微任务队列中存在
//两个flushCallBacks，也不会出现callback重复的情况
function flushCallbacks() {
  //执行完毕，将pending状态置为false，允许下一次添加回调
  pending = false;
  //执行flushCallbacks时，将callbacks浅拷贝到copies上，然后清空callbacks
  //再用copies代替执行callback函数
  const copies = callbacks.slice(0);
  callbacks.length = 0;
  //循环调用回调队列中的每一个回调函数(或用户定义的fn，或nextTick添加的Promise，但是
  //都包装在同一个回调函数中)
  for (let i = 0; i < copies.length; i++) {
    copies[i]();
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
let timerFunc;

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
if (typeof Promise !== "undefined" && isNative(Promise)) {
  const p = Promise.resolve();
  timerFunc = () => {
    p.then(flushCallbacks);
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.

    //isIOS  苹果设备
    if (isIOS) setTimeout(noop);
  };
  isUsingMicroTask = true;
} else if (
  //MutationObserver 是dom元素的观察者
  !isIE &&
  typeof MutationObserver !== "undefined" &&
  (isNative(MutationObserver) ||
    // PhantomJS and iOS 7.x
    MutationObserver.toString() === "[object MutationObserverConstructor]")
) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
  let counter = 1;
  const observer = new MutationObserver(flushCallbacks);
  const textNode = document.createTextNode(String(counter));
  observer.observe(textNode, {
    characterData: true,
  });
  timerFunc = () => {
    counter = (counter + 1) % 2;
    textNode.data = String(counter);
  };
  isUsingMicroTask = true;
} else if (typeof setImmediate !== "undefined" && isNative(setImmediate)) {
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
  timerFunc = () => {
    setImmediate(flushCallbacks);
  };
} else {
  // Fallback to setTimeout.
  timerFunc = () => {
    setTimeout(flushCallbacks, 0);
  };
}

export function nextTick(cb?: Function, ctx?: Object) {
  //_resolve引用一个Promise实例的resolve，并且在调用$nextTick的时候
  //会返回这个Promise的实例(如果没有cb)，因此，用.then的方法可以接收到
  //执行状态和返回信息

  //每一个_resolve都维护自己当前$nextTick函数返回Promise(如是)的reslove函数

  //注意：callbacks不仅仅有用户自身注册的$nextTick callback，还有的就是queueWatcher
  //的flushScheduleQueue
  let _resolve;
  callbacks.push(() => {
    if (cb) {
      try {
        cb.call(ctx);
      } catch (e) {
        handleError(e, ctx, "nextTick");
      }
    } else if (_resolve) {
      _resolve(ctx);
    }
  });

  //

  //pending：回调队列是否为空，是否需要等待刷新；
  //如果不需要，则意味着此时回调队列已被注册，则不需要再次调用timerFunc，
  //只需要添加进入回调队列即可
  if (!pending) {
    pending = true;
    timerFunc();
  }

  // $flow-disable-line
  //如果没有cb则返回promise，可以在.then内执行回调
  //如果有cb则直接在内部的callbacks队列内执行回调cb
  if (!cb && typeof Promise !== "undefined") {
    return new Promise((resolve) => {
      _resolve = resolve;
    });
  }
}
