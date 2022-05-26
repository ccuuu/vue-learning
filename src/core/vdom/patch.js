/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from "./vnode";
import config from "../config";
import { SSR_ATTR } from "shared/constants";
import { registerRef } from "./modules/ref";
import { traverse } from "../observer/traverse";
import { activeInstance } from "../instance/lifecycle";
import { isTextInputType } from "web/util/element";

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive,
} from "../util/index";
import { extractPropsFromVNodeData } from "./helpers";
import { leave } from "../../platforms/web/runtime/modules/transition";

export const emptyNode = new VNode("", {}, []);

const hooks = ["create", "activate", "update", "remove", "destroy"];

//也就是两种情况：
//1，对于普通节点来说。key相同(同为undefined也可)，tag相同，都是comment，并且data同时都
//   定义或未定义
//2，对于组件节点来说。key相同(同为undefined也可)，构造函数相同。并且满足（组件加载成功
//   的情况下，tag，isComment等条件相同， 或者组件为加载成功，b没有报错，即当作相同）

//对于组件节点来说，tag为 vue-component-构造函数的id
function sameVnode(a, b) {
  //asyncFactory 为组件节点的构造函数
  return (
    //如果key相同
    a.key === b.key &&
    //构造函数相同(对于组件节点来说。普通节点的asyncFactory都为undefined)
    a.asyncFactory === b.asyncFactory &&
    //tag相同，isComment相同，data都存在，对应的inputType也相同
    //或者 其为a节点为占位节点（异步组件未加载成功时），并且b节点么有error
    ((a.tag === b.tag &&
      a.isComment === b.isComment &&
      isDef(a.data) === isDef(b.data) &&
      sameInputType(a, b)) ||
      (isTrue(a.isAsyncPlaceholder) && isUndef(b.asyncFactory.error)))
  );
}

function sameInputType(a, b) {
  if (a.tag !== "input") return true;
  let i;
  const typeA = isDef((i = a.data)) && isDef((i = i.attrs)) && i.type;
  const typeB = isDef((i = b.data)) && isDef((i = i.attrs)) && i.type;
  return typeA === typeB || (isTextInputType(typeA) && isTextInputType(typeB));
}

function createKeyToOldIdx(children, beginIdx, endIdx) {
  let i, key;
  const map = {};
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key;
    if (isDef(key)) map[key] = i;
  }
  return map;
}

export function createPatchFunction(backend) {
  let i, j;
  const cbs = {};

  const { modules, nodeOps } = backend;

  //cbs中存放的就是 modules中相对应的事件钩子：
  //  web的钩子：
  //{
  //   create: updateAttrs,
  //   update: updateAttrs
  // }
  // {
  //   create: updateClass,
  //   update: updateClass
  // }
  // {
  //   create: updateDOMListeners,
  //   update: updateDOMListeners,
  //   destroy: (vnode: VNodeWithData) => updateDOMListeners(vnode, emptyNode)
  // }
  // {
  //   create: updateDOMProps,
  //   update: updateDOMProps
  // }
  // {
  //   create: updateStyle,
  //   update: updateStyle
  // }
  //transition的：
  // {
  //   create: _enter,
  //   activate: _enter,
  //   remove (vnode: VNode, rm: Function) {
  //     /* istanbul ignore else */
  //     if (vnode.data.show !== true) {
  //       leave(vnode, rm)
  //     } else {
  //       rm()
  //     }
  //   }
  // }

  //baseModules
  // {
  //   create (_: any, vnode: VNodeWithData) {
  //     registerRef(vnode)
  //   },
  //   update (oldVnode: VNodeWithData, vnode: VNodeWithData) {
  //     if (oldVnode.data.ref !== vnode.data.ref) {
  //       registerRef(oldVnode, true)
  //       registerRef(vnode)
  //     }
  //   },
  //   destroy (vnode: VNodeWithData) {
  //     registerRef(vnode, true)
  //   }
  // }
  // {
  //   create: updateDirectives,
  //   update: updateDirectives,
  //   destroy: function unbindDirectives (vnode: VNodeWithData) {
  //     updateDirectives(vnode, emptyNode)
  //   }
  // }

  //整理一下：
  const cbsDoc = {
    create: [
      (vnode) => {
        //将ref属性添加至当前vNode所在实例的$refs中
        registerRef(vnode);
      },
      //就是一个触发directives相应钩子的行为。同时会将一些钩子添加至vnode中
      updateDirectives,
      //就是一个通过比较 oldValue和newValue，做setAttribute和removeAttribute操作
      updateAttrs,
      //就是一个获取class（从父节点、子节点中的非DOM vNode节点获取到所有的class，并合并），
      //格式化class（最终会将class处理为字符串classNames的形式），最终调用
      //setAttribute('class'，value)添加class的过程
      updateClass,
      //就是一个给元素addEventListener、removeEventListener处理事件的过程
      updateDOMListeners,
      //就是通过直接属性访问的形式，添加 ( 或者修改 ) domProps。
      updateDOMProps,
      //通过 el.style.setProperty或者el.style的属性访问的方式，添加或修改style
      updateStyle,
      _enter,
    ],
    update: [
      (oldVnode, vnode) => {
        if (oldVnode.data.ref !== vnode.data.ref) {
          //先移除，后新增
          registerRef(oldVnode, true);
          registerRef(vnode);
        }
      },
      updateDirectives,
      updateAttrs,
      updateClass,
      updateDOMListeners,
      updateDOMProps,
      updateStyle,
    ],
    remove: [
      (vnode, rm) => {
        if (vnode.data.show !== true) {
          leave(vnode, rm);
        } else {
          rm();
        }
      },
    ],
    destroy: [
      //即移除从父实例的$refs中移除当前节点对应的ref
      (vnode) => registerRef(vnode, true),
      //移除每一个directive，并触发其unbind回调
      (vnode) => updateDirectives(vnode, emptyNode),
      //即执行相关的removeEventListener操作
      (vnode) => updateDOMListeners(vnode, emptyNode),
    ],
  };
  //
  //
  //
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = [];
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]]);
      }
    }
  }

  function emptyNodeAt(elm) {
    return new VNode(
      nodeOps.tagName(elm).toLowerCase(),
      {},
      [],
      undefined,
      elm
    );
  }

  function createRmCb(childElm, listeners) {
    function remove() {
      if (--remove.listeners === 0) {
        removeNode(childElm);
      }
    }
    remove.listeners = listeners;
    return remove;
  }

  function removeNode(el) {
    const parent = nodeOps.parentNode(el);
    // element may have already been removed due to v-html / v-text
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el);
    }
  }

  function isUnknownElement(vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some((ignore) => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag;
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    );
  }

  let creatingElmInVPre = 0;

  function createElm(
    //当前节点
    vnode,
    insertedVnodeQueue,
    //父节点对应的DOM元素
    parentElm,
    refElm,
    //嵌套，也就是是否为其他节点的后代节点
    nested,
    //作为其他后代节点的children对应的数组
    ownerArray,
    //上面数组对应的下标位置
    index
  ) {
    //如果vnode.elm属性存在，且ownerArray存在，即代表此时解析的是一个已经解析过的
    //vnode。此时为了防止渲染问题，重新克隆一份用作本次create
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.

      //不使用当前真实的vnode，而是克隆一份vnode
      vnode = ownerArray[index] = cloneVNode(vnode);
    }

    //如果不是嵌套的，则为其标志上isRootInsert
    vnode.isRootInsert = !nested; // for transition enter check
    //如果该节点对应着一个实例，则创建component。
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return;
    }

    const data = vnode.data;
    const children = vnode.children;
    const tag = vnode.tag;
    if (isDef(tag)) {
      if (process.env.NODE_ENV !== "production") {
        if (data && data.pre) {
          creatingElmInVPre++;
        }
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          warn(
            "Unknown custom element: <" +
              tag +
              "> - did you " +
              "register the component correctly? For recursive components, " +
              'make sure to provide the "name" option.',
            vnode.context
          );
        }
      }

      //基于tag创建DOM节点,并添加至elm属性中。
      //创建DOM节点是在 children的创建之前执行
      vnode.elm = vnode.ns
        ? nodeOps.createElementNS(vnode.ns, tag)
        : nodeOps.createElement(tag, vnode);

      //为节点添加上_scopedId属性。(对应<style scoped >)
      setScope(vnode);

      /* istanbul ignore if */
      if (__WEEX__) {
        // // in Weex, the default insertion order is parent-first.
        // // List items can be optimized to use children-first insertion
        // // with append="tree".
        // const appendAsTree = isDef(data) && isTrue(data.appendAsTree);
        // if (!appendAsTree) {
        //   if (isDef(data)) {
        //     invokeCreateHooks(vnode, insertedVnodeQueue);
        //   }
        //   insert(parentElm, vnode.elm, refElm);
        // }
        // createChildren(vnode, children, insertedVnodeQueue);
        // if (appendAsTree) {
        //   if (isDef(data)) {
        //     invokeCreateHooks(vnode, insertedVnodeQueue);
        //   }
        //   insert(parentElm, vnode.elm, refElm);
        // }
      } else {
        // 后序遍历，先生成children的DOM节点
        createChildren(vnode, children, insertedVnodeQueue);

        //在生成完children之后，判断该vnode是否存在data。
        if (isDef(data)) {
          //若存在，则调用 create钩子。也就是  cbs中的各项create方法
          //初始化 事件、attrs、domProps、directives、class、style、ref

          //在组件节点中，会在其实例化之后调用，而在普通标签节点当中，会在
          //children创建完成之后调用
          invokeCreateHooks(vnode, insertedVnodeQueue);
        }
        //将当前生成的DOM点插入到父DOM节点当中
        insert(parentElm, vnode.elm, refElm);
      }

      if (process.env.NODE_ENV !== "production" && data && data.pre) {
        creatingElmInVPre--;
      }
      //如果是注释节点
    } else if (isTrue(vnode.isComment)) {
      //创建comment节点
      vnode.elm = nodeOps.createComment(vnode.text);
      //直接插入（因为comment节点不存在children）
      insert(parentElm, vnode.elm, refElm);
      //如果是文本节点
    } else {
      //创建文本节点
      vnode.elm = nodeOps.createTextNode(vnode.text);
      //直接插入（因为text节点不存在children）
      insert(parentElm, vnode.elm, refElm);
    }
  }

  function createComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data;
    if (isDef(i)) {
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive;
      if (isDef((i = i.hook)) && isDef((i = i.init))) {
        //调用组件的init钩子，初始化组件

        //最终会将组件初始化。并且完成子组件的beforeCreate、created、beforeMount、mounted
        //当然，这是一个递归的过程，当前行代码的执行会导致 子组件中进行同样的初始化操作
        // _render、_update、然后在子组件的patch中完成一切操作之后，再回到这一次的函数
        //调用栈继续执行
        i(vnode, false /* hydrating */);
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      if (isDef(vnode.componentInstance)) {
        //给组件节点的elm赋值，指向实例的$el
        initComponent(vnode, insertedVnodeQueue);
        //将当前创建的真实DOM节点添加至parentElm中。到此，也就完成了 子组件 从创建
        //到挂载到真是添加进DOM树的过程
        insert(parentElm, vnode.elm, refElm);
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm);
        }
        return true;
      }
    }
  }

  //作用是：
  //1，添加vnodeQueue（如需要）
  //2，设置elm（再组件实例化的时候若指定了挂载节点，则elm并不会发生改变。因为
  //componentInstance.$el指向的就是挂载节点，或创建节点）
  //3，调用create钩子
  //4，设置作用域

  //如果vnode为空组件，则只会初始化ref
  function initComponent(vnode, insertedVnodeQueue) {
    //pendingInsert：在invokeInsertHook中初始化
    if (isDef(vnode.data.pendingInsert)) {
      insertedVnodeQueue.push.apply(
        insertedVnodeQueue,
        vnode.data.pendingInsert
      );
      vnode.data.pendingInsert = null;
    }
    //vnode.elm 在此赋值。对应的即是页面上的DOM节点
    vnode.elm = vnode.componentInstance.$el;
    //如果组件节点对应的实例的内部是有效节点，即对应了真实的DOM而非空组件
    if (isPatchable(vnode)) {
      //调用create钩子，包括初始化 class，event，style，dirctives，attrs，domProps
      //等等
      invokeCreateHooks(vnode, insertedVnodeQueue);
      //设置作用域
      setScope(vnode);

      //否则
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      //初始化ref
      registerRef(vnode);
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode);
    }
  }

  function reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    let i;
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode;
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode;
      if (isDef((i = innerNode.data)) && isDef((i = i.transition))) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode);
        }
        insertedVnodeQueue.push(innerNode);
        break;
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm);
  }

  //insert函数的作用： 将当前DOM元素插入到父DOM元素当中
  //如果传入的第三个参数，则insertBefore，否则，appendChild
  function insert(parent, elm, ref) {
    //如果parent不存在，则不执行。
    //对应的就是 根节点的insert，此时是不存在parent的，则不会在此做插入操作
    if (isDef(parent)) {
      if (isDef(ref)) {
        //parentNode方法就是通过某个节点(也就是这里的ref)去反查parentNode，并返回
        //如果此ref的parent是elm的parent，则insertBefore
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref);
        }
        //如果ref为定义，则appendChild
      } else {
        nodeOps.appendChild(parent, elm);
      }
    }
  }

  //历遍children做createElm操作，并将生成的DOM元素插入到当前DOM节点当中
  function createChildren(vnode, children, insertedVnodeQueue) {
    //如果后代是数组（如果是标签节点，则一定为数组。因为在生成vNode的时候和句法解析的
    //时候就已经处理过了。这也就是为什么自己再写render函数的时候，标签节点没有包裹
    //在数组下就不会生效的原因）
    if (Array.isArray(children)) {
      if (process.env.NODE_ENV !== "production") {
        //检测每一个child的key是否唯一
        checkDuplicateKeys(children);
      }
      //遍历每一项后代，执行createElm操作
      for (let i = 0; i < children.length; ++i) {
        createElm(
          children[i],
          insertedVnodeQueue,
          vnode.elm,
          null,
          true,
          children,
          i
        );
      }
    } else if (isPrimitive(vnode.text)) {
      //如果vnode的后代是文本节点，则将其当作文本节点插入到当前节点创建的
      //DOM节点的children当中
      nodeOps.appendChild(
        vnode.elm,
        nodeOps.createTextNode(String(vnode.text))
      );
    }
  }

  function isPatchable(vnode) {
    //对于组件节点来说，vnode为父组件的挂载节点，而componentInstance._vnode
    //为自身的vnode。
    //比如： <children />
    //那么 vnode就为children这个节点，但是 _vnode为children组件内部的 根元素
    // 或许是 div(或其他)
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode;
    }
    //如果组件对应的根元素存在tag，则返回true
    return isDef(vnode.tag);
  }

  function invokeCreateHooks(vnode, insertedVnodeQueue) {
    for (let i = 0; i < cbs.create.length; ++i) {
      //调用 cbs中的 create钩子
      cbs.create[i](emptyNode, vnode);
    }
    //如果vnode节点中存在hook属性(对应的就是组件节点，在创建vnode的时候会给每个
    //组件节点都添加该属性)
    i = vnode.data.hook; // Reuse variable
    //如果该组件节点存在如下两个钩子，则调用
    if (isDef(i)) {
      if (isDef(i.create)) i.create(emptyNode, vnode);
      //如果存在insert钩子，则将该vnode插入insertedVnodeQueue中
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode);
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.

  //_scopeId 是vue-loader在解析 vue文件的时候生成的 供style标签中的
  //scoped使用的ID，是用来标识每一个文件的唯一ID。
  //当文件中的style使用了 scoped 属性，那么当其解析时，它的css选择器就会
  //带有一个属性选择器：
  //div[data-v-xxxxxxx]，而在DOM生成的时候，也会在每个DOM节点上根据_scopeId
  //添加一个相对应的属性，从而实现 css的"作用域"
  function setScope(vnode) {
    let i;
    if (isDef((i = vnode.fnScopeId))) {
      nodeOps.setStyleScope(vnode.elm, i);
    } else {
      let ancestor = vnode;
      //向上找到挂载实例的节点，并用其_scopeId作为此节点的scopeId

      //这也就意味着，同一个 实例节点包裹的非实例节点，都会用到
      //当前实例的_scopeId
      while (ancestor) {
        if (isDef((i = ancestor.context)) && isDef((i = i.$options._scopeId))) {
          nodeOps.setStyleScope(vnode.elm, i);
        }
        ancestor = ancestor.parent;
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    //activeInstance为当前正在执行patch的实例
    //vnode.context为当前节点所在的上下文实例

    //activeInstance !== context, 也就意味着
    if (
      isDef((i = activeInstance)) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef((i = i.$options._scopeId))
    ) {
      //将实例节点也添加scopedId
      nodeOps.setStyleScope(vnode.elm, i);
    }
  }

  function addVnodes(
    parentElm,
    refElm,
    vnodes,
    startIdx,
    endIdx,
    insertedVnodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(
        vnodes[startIdx],
        insertedVnodeQueue,
        parentElm,
        refElm,
        false,
        vnodes,
        startIdx
      );
    }
  }

  function invokeDestroyHook(vnode) {
    let i, j;
    const data = vnode.data;
    if (isDef(data)) {
      //如果data存在，就从data的 hook属性里面取出 destroy方法，并执行。
      if (isDef((i = data.hook)) && isDef((i = i.destroy))) i(vnode);
      //调用cbs中的destroy方法
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
    }
    //如果当前需要destroy的vNode还存在children，则对其后代递归的调用destroy钩子
    if (isDef((i = vnode.children))) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j]);
      }
    }
  }

  function removeVnodes(vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      //在此判断isDef是因为在diff算法中会将一些项置为undefined（位置不匹配但是节点
      //匹配的项）
      if (isDef(ch)) {
        if (isDef(ch.tag)) {
          removeAndInvokeRemoveHook(ch);
          invokeDestroyHook(ch);
        } else {
          // Text node
          removeNode(ch.elm);
        }
      }
    }
  }

  function removeAndInvokeRemoveHook(vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i;
      const listeners = cbs.remove.length + 1;
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners;
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners);
      }
      // recursively invoke hooks on child component root node
      if (
        isDef((i = vnode.componentInstance)) &&
        isDef((i = i._vnode)) &&
        isDef(i.data)
      ) {
        removeAndInvokeRemoveHook(i, rm);
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm);
      }
      if (isDef((i = vnode.data.hook)) && isDef((i = i.remove))) {
        i(vnode, rm);
      } else {
        rm();
      }
    } else {
      removeNode(vnode.elm);
    }
  }

  //diff算法

  //diff算法对于old双端都为不匹配的节点的时候，没有优势（会导致一直不会命中）
  //如： 1，2，3，4  和   6，4，3，2，1，5
  function updateChildren(
    parentElm,
    oldCh,
    newCh,
    insertedVnodeQueue,
    removeOnly
  ) {
    //初始化4个指针
    let oldStartIdx = 0;
    let newStartIdx = 0;
    let oldEndIdx = oldCh.length - 1;
    let newEndIdx = newCh.length - 1;

    //初始化指针指向的节点（哨兵）
    let oldStartVnode = oldCh[0];
    let oldEndVnode = oldCh[oldEndIdx];
    let newStartVnode = newCh[0];
    let newEndVnode = newCh[newEndIdx];

    let oldKeyToIdx, idxInOld, vnodeToMove, refElm;

    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    const canMove = !removeOnly;

    if (process.env.NODE_ENV !== "production") {
      checkDuplicateKeys(newCh);
    }

    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      //以下isUndef的两步是为了处理 没有命中双端的情况，则在patch的时候会将
      //当前oldCh中的对应下标项置为undefined，但是并不会处理index（实际上也
      //无法处理）。而index则/是在下一次循环的开头（也就是这里）做处理
      if (isUndef(oldStartVnode)) {
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) {
        oldEndVnode = oldCh[--oldEndIdx];
        //如果oldStart和newStart相同
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        patchVnode(
          oldStartVnode,
          newStartVnode,
          insertedVnodeQueue,
          newCh,
          newStartIdx
        );
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
        //如果oldEnd和newEnd相同
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        patchVnode(
          oldEndVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        );
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
        //如果oldStart和newEnd相同
      } else if (sameVnode(oldStartVnode, newEndVnode)) {
        // Vnode moved right
        patchVnode(
          oldStartVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        );
        //当匹配到的位置不一致的时候，除了需要将vNode的位置转换过来，同样也需要将
        //DOM节点的位置转换过来。
        //不过这一步操作是在patchVnode之后的，也就意味着当执行到这一步的时候，当前
        //节点对应的DOM节点的所有子节点都已经patch过了。（dfs深度优先）

        //除了 newStart匹配oldStart，newEnd匹配oldEnd的情况，其他都需要转换DOM节点
        //的位置
        canMove &&
          nodeOps.insertBefore(
            parentElm,
            oldStartVnode.elm,
            nodeOps.nextSibling(oldEndVnode.elm)
          );
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
        //如果oldEnd和newStart相同
      } else if (sameVnode(oldEndVnode, newStartVnode)) {
        // Vnode moved left
        patchVnode(
          oldEndVnode,
          newStartVnode,
          insertedVnodeQueue,
          newCh,
          newStartIdx
        );
        canMove &&
          nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm);
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        //创建一个key对应index的映射
        if (isUndef(oldKeyToIdx))
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);

        //如果key定义，则取映射中处理好的index
        //如果为定义，则历遍寻找和当前newStart为sameNode的index
        idxInOld = isDef(newStartVnode.key)
          ? oldKeyToIdx[newStartVnode.key]
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx);

        //如果当前指向的new节点找不到这样的index，则直接创建一个新的ele作为当前
        //vNode的elm
        if (isUndef(idxInOld)) {
          // New element
          createElm(
            newStartVnode,
            insertedVnodeQueue,
            parentElm,
            oldStartVnode.elm,
            false,
            newCh,
            newStartIdx
          );
        } else {
          //从old中找到需要移动的vNode
          vnodeToMove = oldCh[idxInOld];
          //如果key相同，且为sameVnode，则做patch处理，且将old中的节点置为undefined
          //将此元素插入到与oldStart指针指向的元素之前
          if (sameVnode(vnodeToMove, newStartVnode)) {
            patchVnode(
              vnodeToMove,
              newStartVnode,
              insertedVnodeQueue,
              newCh,
              newStartIdx
            );
            oldCh[idxInOld] = undefined;
            canMove &&
              nodeOps.insertBefore(
                parentElm,
                vnodeToMove.elm,
                oldStartVnode.elm
              );
          } else {
            // same key but different element. treat as new element
            //如果key相同，但是不为sameVnode，则创建
            createElm(
              newStartVnode,
              insertedVnodeQueue,
              parentElm,
              oldStartVnode.elm,
              false,
              newCh,
              newStartIdx
            );
          }
        }
        newStartVnode = newCh[++newStartIdx];
      }
    }

    //循环到最后的位置，不一定old节点会是何种情况。甚至有可能指针没移动过（对于
    //某个哨兵一直匹配不到的情况 ），也可能为移动了部分距离。甚至对于new大于old，
    //也是会如此，如： new为1，2，3，4；old为 6，1，5

    //如果此时oldStartIdx > oldEndIdx，则代表old移动完毕，但是new可能移动完毕
    //也可能还有剩余
    //若new中没有剩余，则此时newStartIdx > newEndIdx,即使调用了addVnodes函数
    //也不会生效
    //若new中有剩余，则剩余的一定是未匹配的项。只需要做简单的新增即可。且新增的
    //位置为最后一次匹配到的末尾位置。也就是 newEndIdx+1
    if (oldStartIdx > oldEndIdx) {
      //找到new中匹配的最后一个位置，以其当作insertBefore的坐标插入.
      //从newStartIdx到newEndIdx，就是未被匹配，且需要新增的节点。
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm;
      addVnodes(
        parentElm,
        refElm,
        newCh,
        newStartIdx,
        newEndIdx,
        insertedVnodeQueue
      );
      //如果此时newStartIdx > newEndIdx，则此时old可能移动完毕也可能还有剩余。

      //若old移动完毕，则即使调用removeVnodes也不会生效。
      //若old未移动完毕，则此时oldCh中如果有剩余，且节点不为undefined，则一定代表其
      //未不匹配且多余的项，则删除
    } else if (newStartIdx > newEndIdx) {
      removeVnodes(oldCh, oldStartIdx, oldEndIdx);
    }
  }

  //作用就是检测当前传入参数的children每一项的key是否唯一
  function checkDuplicateKeys(children) {
    const seenKeys = {};
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i];
      const key = vnode.key;
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          );
        } else {
          seenKeys[key] = true;
        }
      }
    }
  }

  function findIdxInOld(node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i];
      if (isDef(c) && sameVnode(node, c)) return i;
    }
  }

  function patchVnode(
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray,
    index,
    removeOnly
  ) {
    if (oldVnode === vnode) {
      return;
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode
      vnode = ownerArray[index] = cloneVNode(vnode);
    }

    //将oldVnode的DOM元素赋值给vnode
    const elm = (vnode.elm = oldVnode.elm);

    //此处是针对于异步组件的处理
    //如果patch之时，oldVnode还是占位元素，并且此时的vnode已经加载完成
    //则调用hydrate
    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue);
      } else {
        //否则，则代表本次的节点使用的还是占位元素
        vnode.isAsyncPlaceholder = true;
      }
      return;
    }

    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.

    //如果new节点和old节点都是static节点，并且key相等，并且isOnce或者isCloned，则
    //直接将componentInstance简单赋值并返回

    //componentInstance也就是当前patch的组件节点对应的真实组件实例
    if (
      isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      vnode.componentInstance = oldVnode.componentInstance;
      return;
    }

    let i;
    const data = vnode.data;
    //调用组件节点的prepatch钩子，也就是刷新子组件。
    if (isDef(data) && isDef((i = data.hook)) && isDef((i = i.prepatch))) {
      i(oldVnode, vnode);
    }

    const oldCh = oldVnode.children;
    const ch = vnode.children;
    if (isDef(data) && isPatchable(vnode)) {
      //调用cbs的update钩子和directives的update钩子。也就是更新DOM的一些属性
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode);
      if (isDef((i = data.hook)) && isDef((i = i.update))) i(oldVnode, vnode);
    }
    //如果new中的text属性不存在，即代表其为标签节点或组件节点
    if (isUndef(vnode.text)) {
      //如果old和new都存在children
      if (isDef(oldCh) && isDef(ch)) {
        //如果二者不相等。事实上二者一定不相等，因为每次通过render创建的vnode
        //一定是独立的
        if (oldCh !== ch)
          updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly);

        //如果new中存在children而old中不存在，则只需要插入即可
      } else if (isDef(ch)) {
        if (process.env.NODE_ENV !== "production") {
          checkDuplicateKeys(ch);
        }
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, "");
        //addVnodes就是遍历0到ch.length-1项，调用createElm函数生成并插入节点
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);

        //如果old中存在children而new中不存在，则只需要删除即可
      } else if (isDef(oldCh)) {
        removeVnodes(oldCh, 0, oldCh.length - 1);

        //如果old为text，且new不存在子节点，则将text设置为空字符串即可
      } else if (isDef(oldVnode.text)) {
        nodeOps.setTextContent(elm, "");
      }
      //如果new为text，且old的text与其不相等(或许old不是文本节点，但无论其为何种形式
      //只要与当前的new中的text不相等，都是将其重置为对应的文本节点)
    } else if (oldVnode.text !== vnode.text) {
      nodeOps.setTextContent(elm, vnode.text);
    }
    //在更新的最后，调用postpatch钩子。对应的就是directives的componentUpdated钩子
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.postpatch)))
        i(oldVnode, vnode);
    }
  }

  function invokeInsertHook(vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    if (isTrue(initial) && isDef(vnode.parent)) {
      //vnode.parent属性在生成vnode的时候添加，指向的是父组件中当前组件的占位vNode

      //将父节组件占位节点的pendingInsert指向此组件的insertedVnodeQueue
      vnode.parent.data.pendingInsert = queue;
    } else {
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i]);
      }
    }
  }

  let hydrationBailed = false;
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap("attrs,class,staticClass,staticStyle,key");

  // Note: this is a browser-only function so we can assume elms are DOM nodes.

  // 详情参考： https://v3.cn.vuejs.org/guide/ssr/hydration.html
  //简单来说，就是 “激活” 一个DOM节点
  function hydrate(elm, vnode, insertedVnodeQueue, inVPre) {
    let i;
    const { tag, data, children } = vnode;
    inVPre = inVPre || (data && data.pre);
    //elm为oldVnode的elm
    vnode.elm = elm;

    //如果节点 isComment，且是一个异步组件，则直接将vnode的isAsyncPlaceholder置为
    //true，然后返回
    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true;
      return true;
    }
    // assert node match
    if (process.env.NODE_ENV !== "production") {
      //判断节点和DOM元素是否匹配。若不匹配则直接返回（通过判断tag相同，或者tag为组
      //件节点的生成tag。或者若不存在tag，通过类型匹配判断）
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false;
      }
    }

    //如果data定义（此处仅仅是处理组件节点的情况，而不包括其他节点的data）
    if (isDef(data)) {
      //如果data存在init，则调用init初始化
      if (isDef((i = data.hook)) && isDef((i = i.init)))
        //此时的初始化，不需要再做insert操作。因为这个时候的vnode.elm有值，会在
        //初始化的时候就用次elm挂载（注意：hydrating参数传了true。只有在hydrating
        //为true的时候才会使用elm挂载）

        //而具体的patch操作，交给了子组件的 patch 去完成（在第一次patch的时候就会对比
        //第一个和第二个参数）
        i(vnode, true /* hydrating */);
      if (isDef((i = vnode.componentInstance))) {
        // child component. it should have hydrated its own tree.
        //初始化component操作（create钩子，作用域，添加queue）
        initComponent(vnode, insertedVnodeQueue);
        //返回true
        return true;
      }
    }
    //如果tag存在
    if (isDef(tag)) {
      //如果存在children
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        //如果elm不存在childNodes，则代表children为新生成的。则此时只需要做
        //简单的create，插入，即可
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue);
        } else {
          // v-html and domProps: innerHTML
          //如果innerHTML属性存在。即使用了v-html指令（在generate的时候会将v-html
          //指令处理为domProps的innerHTML属性）
          if (
            isDef((i = data)) &&
            isDef((i = i.domProps)) &&
            isDef((i = i.innerHTML))
          ) {
            //如果此时的innerHTML属性不等于old的innerHTML内容，则直接返回false，并warn
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (
                process.env.NODE_ENV !== "production" &&
                typeof console !== "undefined" &&
                !hydrationBailed
              ) {
                hydrationBailed = true;
                console.warn("Parent: ", elm);
                console.warn("server innerHTML: ", i);
                console.warn("client innerHTML: ", elm.innerHTML);
              }
              return false;
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true;
            let childNode = elm.firstChild;
            //将oldVnode中的elm和当前vnode的children一一对应的比较。
            //如果存在任意不相同的一项，则跳出循环，childrenMatch置为false
            for (let i = 0; i < children.length; i++) {
              if (
                !childNode ||
                !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)
              ) {
                childrenMatch = false;
                break;
              }
              childNode = childNode.nextSibling;
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            //在上述循环中，会存在一个问题：
            //当vNode的children比elm中childNodes少的时候，如果children的所有内容
            //都相匹配，则此时childrenMatch为true。但此时他们应该是不匹配的，因为
            //数量都不相等
            //而 || childNode，就是处理这种情况：当childNode = childNode.nexSibling
            //在循环结束之后，仍然有值，则代表此时 elm的childNodes比children多

            //如果children和childNodes不匹配，则warn
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (
                process.env.NODE_ENV !== "production" &&
                typeof console !== "undefined" &&
                !hydrationBailed
              ) {
                hydrationBailed = true;
                console.warn("Parent: ", elm);
                console.warn(
                  "Mismatching childNodes vs. VNodes: ",
                  elm.childNodes,
                  children
                );
              }
              return false;
            }
          }
        }
      }

      //如果data定义
      if (isDef(data)) {
        let fullInvoke = false;
        for (const key in data) {
          //isRenderedModule：判断key是否等于attrs,class,staticClass,staticStyle,key
          if (!isRenderedModule(key)) {
            //如果存在属性不为上述属性的，则fullInvoke为true
            fullInvoke = true;
            //调用create钩子。也就是cbs中的create
            invokeCreateHooks(vnode, insertedVnodeQueue);
            break;
          }
        }
        if (!fullInvoke && data["class"]) {
          // ensure collecting deps for deep class bindings for future updates

          //遍历class，添加依赖
          traverse(data["class"]);
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text;
    }
    return true;
  }

  //判断节点和DOM元素是否匹配（通过判断tag相同，或者tag为组件节点的生成tag。或者
  //若不存在tag，通过类型匹配判断）
  function assertNodeMatch(node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return (
        //节点为组件节点
        vnode.tag.indexOf("vue-component") === 0 ||
        //不为为止元素
        (!isUnknownElement(vnode, inVPre) &&
          //vnode的tag和DOM元素的tag相同
          vnode.tag.toLowerCase() ===
            (node.tagName && node.tagName.toLowerCase()))
      );
    } else {
      //DOM元素的nodeType：
      //1对应元素节点
      //3对应文本
      //8对应注释
      return node.nodeType === (vnode.isComment ? 8 : 3);
    }
  }

  return function patch(oldVnode, vnode, hydrating, removeOnly) {
    //如果新节点不存在，但是老节点存在。则调用destroy钩子
    if (isUndef(vnode)) {
      //注意：传入的参数为oldVnode
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode);
      return;
    }

    let isInitialPatch = false;
    const insertedVnodeQueue = [];

    //如果oldVnode为空。也就是$mount传递的el参数为空。直接走新建流程
    if (isUndef(oldVnode)) {
      // empty mount (likely as component), create new root element
      isInitialPatch = true;
      //创建DOM
      createElm(vnode, insertedVnodeQueue);
    } else {
      //如果vNode中的nodeType属性存在，即代表此node对应真实的节点
      const isRealElement = isDef(oldVnode.nodeType);

      //如果其为组件节点，并且二者判断相同
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // patch existing root node
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly);
      } else {
        //如果old节点和new节点不相同，则old可能为$mount定义的el。此时，做hydrate处理
        if (isRealElement) {
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          //根节点才会带有SSR_ATTR属性
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR);
            hydrating = true;
          }
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              invokeInsertHook(vnode, insertedVnodeQueue, true);
              return oldVnode;
            } else if (process.env.NODE_ENV !== "production") {
              warn(
                "The client-side rendered virtual DOM tree is not matching " +
                  "server-rendered content. This is likely caused by incorrect " +
                  "HTML markup, for example nesting block-level elements inside " +
                  "<p>, or missing <tbody>. Bailing hydration and performing " +
                  "full client-side render."
              );
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it

          //创建一个空节点
          oldVnode = emptyNodeAt(oldVnode);
        }

        // replacing existing element
        const oldElm = oldVnode.elm;
        const parentElm = nodeOps.parentNode(oldElm);

        // create new node
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm)
        );

        // update parent placeholder node element, recursively
        if (isDef(vnode.parent)) {
          let ancestor = vnode.parent;
          const patchable = isPatchable(vnode);
          while (ancestor) {
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor);
            }
            ancestor.elm = vnode.elm;
            if (patchable) {
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor);
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert;
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]();
                }
              }
            } else {
              registerRef(ancestor);
            }
            ancestor = ancestor.parent;
          }
        }

        // destroy old node

        //销毁old节点
        if (isDef(parentElm)) {
          removeVnodes([oldVnode], 0, 0);
        } else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode);
        }
      }
    }

    //整个 patch 的create也可以看作是一个dfs的过程
    //若在生成的过程中遇到了组件节点，则递归的调用组件节点的创建，也就是patch等
    //直到整个组件的所有节点都递归的(包括createElement对children的递归和createComponent
    //的patch递归)执行完毕，会在此调用 insertHook 。对于当前正在解析的组件实例
    //来说，会为其根节点添加上相应的属性，供父组件的patch使用
    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch);
    return vnode.elm;
  };
}
