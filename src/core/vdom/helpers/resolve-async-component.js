/* @flow */

import {
  warn,
  once,
  isDef,
  isUndef,
  isTrue,
  isObject,
  hasSymbol,
  isPromise,
  remove,
} from "core/util/index";

import { createEmptyVNode } from "core/vdom/vnode";
import { currentRenderingInstance } from "core/instance/render";

function ensureCtor(comp: any, base) {
  //如果返回值是一个esModule，则default才是最终真实的值。(export default)
  if (comp.__esModule || (hasSymbol && comp[Symbol.toStringTag] === "Module")) {
    comp = comp.default;
  }
  //如果其为一个对象，则继承Vue，最终返回一个继承了Vue的Sub类
  return isObject(comp) ? base.extend(comp) : comp;
}

export function createAsyncPlaceholder(
  factory: Function,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag: ?string
): VNode {
  const node = createEmptyVNode();
  node.asyncFactory = factory;
  node.asyncMeta = { data, context, children, tag };
  return node;
}

export function resolveAsyncComponent(
  factory: Function,
  baseCtor: Class<Component>
): Class<Component> | void {
  //如果该异步函数error，则返回定义的错误模板，不再解析
  if (isTrue(factory.error) && isDef(factory.errorComp)) {
    return factory.errorComp;
  }

  //如果该异步函数在之前已经处理过，则直接返回缓存
  if (isDef(factory.resolved)) {
    return factory.resolved;
  }

  //owner即为此子组件的外层实例
  const owner = currentRenderingInstance;
  //如果owner存在，异步函数的owners属性存在，且owner不在owners中
  if (owner && isDef(factory.owners) && factory.owners.indexOf(owner) === -1) {
    // already pending
    factory.owners.push(owner);
  }

  //如果当前异步函数为loading，则返回loadingComp
  if (isTrue(factory.loading) && isDef(factory.loadingComp)) {
    return factory.loadingComp;
  }

  //如果存在owner实例，且此时异步函数的owners属性还未定义，则进入分支
  if (owner && !isDef(factory.owners)) {
    //初始化owners，并将owner放入owners中
    const owners = (factory.owners = [owner]);
    let sync = true;
    let timerLoading = null;
    let timerTimeout = null;

    //在hook:destroyed事件挂载上remove函数。即：若某个owner被销毁，则会自动
    //从相关的异步函数中的owners移除该销毁项
    (owner: any).$on("hook:destroyed", () => remove(owners, owner));

    //forceRender函数：触发每一个owner项的$forceUpdate方法，即强制
    //更新相关实例
    const forceRender = (renderCompleted: boolean) => {
      for (let i = 0, l = owners.length; i < l; i++) {
        (owners[i]: any).$forceUpdate();
      }

      //如果传入的renderCompleted参数为true，则清空owners，且清除两个
      //timer
      if (renderCompleted) {
        owners.length = 0;
        if (timerLoading !== null) {
          clearTimeout(timerLoading);
          timerLoading = null;
        }
        if (timerTimeout !== null) {
          clearTimeout(timerTimeout);
          timerTimeout = null;
        }
      }
    };

    //定义异步函数的resolve回调
    const resolve = once((res: Object | Class<Component>) => {
      // cache resolved
      //ensureCtor函数：将最终的返回结果包装成为Sub构造函数
      factory.resolved = ensureCtor(res, baseCtor);
      // invoke callbacks only if this is not a synchronous resolve
      // (async resolves are shimmed as synchronous during SSR)

      //注意，在整个resolveAsyncComponent的开头和结尾处都定义
      //了sync的值，也就是说如果当异步函数(或许只是写了异步函数，但其实内部
      //仍是同步)为真实的异步，则触发resolve回调的时候，sync就变为了false，
      //而若并不是异步函数，则调用到此处的时候，sync还会是true

      //如果此时不是同步引入的组件，则触发相关组件的强制刷新
      if (!sync) {
        forceRender(true);
      } else {
        owners.length = 0;
      }
    });

    //定义异步函数的reject回调
    const reject = once((reason) => {
      //报错
      process.env.NODE_ENV !== "production" &&
        warn(
          `Failed to resolve async component: ${String(factory)}` +
            (reason ? `\nReason: ${reason}` : "")
        );
      //如果出错，则将error标识为true，且触发相关组件的强制刷新
      if (isDef(factory.errorComp)) {
        factory.error = true;
        forceRender(true);
      }
    });

    const res = factory(resolve, reject);

    //几种特殊的形式：
    // Vue.component(
    //   'async-webpack-example',
    //   // 该 `import` 函数返回一个 `Promise` 对象。
    //   () => import('./my-async-component')
    // )

    //或者高级异步组件：
    // const AsyncComponent = () => ({
    //   // 需要加载的组件 (应该是一个 `Promise` 对象)
    //   component: import('./MyComponent.vue'),
    //   // 异步组件加载时使用的组件
    //   loading: LoadingComponent,
    //   // 加载失败时使用的组件
    //   error: ErrorComponent,
    //   // 展示加载时组件的延时时间。默认值是 200 (毫秒)
    //   delay: 200,
    //   // 如果提供了超时时间且组件加载也超时了，
    //   // 则使用加载失败时使用的组件。默认值是：`Infinity`
    //   timeout: 3000
    // })

    //如果最终异步函数的返回值是一个对象
    if (isObject(res)) {
      //若返回值为Promise，则手动调用then方法，触发resolve或reject回调
      if (isPromise(res)) {
        // () => Promise
        if (isUndef(factory.resolved)) {
          res.then(resolve, reject);
        }
        //处理高级异步组件的情况，即返回值中的component为Promise
      } else if (isPromise(res.component)) {
        //同样的，触发resolve和reject
        res.component.then(resolve, reject);

        //如果自定义了error，则使用此error作为errorComp
        if (isDef(res.error)) {
          factory.errorComp = ensureCtor(res.error, baseCtor);
        }
        //如果定义了loading，则用其作为loadingComp
        if (isDef(res.loading)) {
          factory.loadingComp = ensureCtor(res.loading, baseCtor);
          if (res.delay === 0) {
            factory.loading = true;
          } else {
            timerLoading = setTimeout(() => {
              timerLoading = null;
              //如果到了delay时间后，resolved和error还是true，则代表加载还未
              //完成，resolve和reject的回调都未执行
              if (isUndef(factory.resolved) && isUndef(factory.error)) {
                factory.loading = true;
                //强制刷新一次，即将loadingComp模板展示给用户，而非一直等待。
                //等到加载完成之后，会重新调用一次forceRender，才将最终的真实
                //模板更新上去
                forceRender(false);
              }
            }, res.delay || 200);
          }
        }

        //如果定义了最长等待时间timeout
        if (isDef(res.timeout)) {
          timerTimeout = setTimeout(() => {
            timerTimeout = null;
            //在到达最长等待时间之后，若resolved还是undefined，则代表
            //没有触发resolve，则抛出超时reject

            //因为reject定义的是 once高阶函数，因此，不需要关心此时时候reject
            //过，因为不会执行第二次
            if (isUndef(factory.resolved)) {
              reject(
                process.env.NODE_ENV !== "production"
                  ? `timeout (${res.timeout}ms)`
                  : null
              );
            }
          }, res.timeout);
        }
      }
    }

    sync = false;
    // return in case resolved synchronously
    return factory.loading ? factory.loadingComp : factory.resolved;
  }
}
