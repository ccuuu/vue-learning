/* @flow */

import { emptyNode } from "core/vdom/patch";
import { resolveAsset, handleError } from "core/util/index";
import { mergeVNodeHook } from "core/vdom/helpers/index";

export default {
  create: updateDirectives,
  update: updateDirectives,
  destroy: function unbindDirectives(vnode: VNodeWithData) {
    updateDirectives(vnode, emptyNode);
  },
};

function updateDirectives(oldVnode: VNodeWithData, vnode: VNodeWithData) {
  if (oldVnode.data.directives || vnode.data.directives) {
    _update(oldVnode, vnode);
  }
}

function _update(oldVnode, vnode) {
  //如果oldVnode为空，则为isCreate，新建
  const isCreate = oldVnode === emptyNode;
  //如果vnode为空，则为isDestroy，删除
  const isDestroy = vnode === emptyNode;
  const oldDirs = normalizeDirectives(
    oldVnode.data.directives,
    oldVnode.context
  );
  //取得规范化的directives，最终的结果为键值对的形式。并且值中的def属性即对应的
  //$options自定义的directives
  const newDirs = normalizeDirectives(vnode.data.directives, vnode.context);

  const dirsWithInsert = [];
  const dirsWithPostpatch = [];

  let key, oldDir, dir;
  for (key in newDirs) {
    oldDir = oldDirs[key];
    dir = newDirs[key];
    //如果没有这样的oldDir
    if (!oldDir) {
      // new directive, bind
      //调用 bind 钩子
      callHook(dir, "bind", vnode, oldVnode);
      //如果自定义了inserted事件钩子，则添加至dirsWithInsert中

      //对于web端来说，会给model定义一些钩子
      //_VUEs\_vue\src\platforms\web\runtime\directives\model.js
      if (dir.def && dir.def.inserted) {
        dirsWithInsert.push(dir);
      }
    } else {
      // existing directive, update
      dir.oldValue = oldDir.value;
      dir.oldArg = oldDir.arg;
      //如果old和new都存在，则调用update钩子
      callHook(dir, "update", vnode, oldVnode);
      //如果自定义了componentUpdated钩子，则添加至dirsWithPostpatch中

      //对于web端来说，会给model定义一些钩子
      //_VUEs\_vue\src\platforms\web\runtime\directives\model.js
      if (dir.def && dir.def.componentUpdated) {
        dirsWithPostpatch.push(dir);
      }
    }
  }

  if (dirsWithInsert.length) {
    const callInsert = () => {
      for (let i = 0; i < dirsWithInsert.length; i++) {
        callHook(dirsWithInsert[i], "inserted", vnode, oldVnode);
      }
    };
    //如果是新增(old为empty)，则调用mergeVNodeHook，否则直接调用callInsert
    if (isCreate) {
      mergeVNodeHook(vnode, "insert", callInsert);
    } else {
      callInsert();
    }
  }

  if (dirsWithPostpatch.length) {
    mergeVNodeHook(vnode, "postpatch", () => {
      for (let i = 0; i < dirsWithPostpatch.length; i++) {
        callHook(dirsWithPostpatch[i], "componentUpdated", vnode, oldVnode);
      }
    });
  }

  if (!isCreate) {
    for (key in oldDirs) {
      //如果最新的node中没有 oldNode的某个dirs，则调用其unbind钩子
      if (!newDirs[key]) {
        // no longer present, unbind
        callHook(oldDirs[key], "unbind", oldVnode, oldVnode, isDestroy);
      }
    }
  }
}

const emptyModifiers = Object.create(null);

//规范化directives选项
function normalizeDirectives(
  dirs: ?Array<VNodeDirective>,
  vm: Component
): { [key: string]: VNodeDirective } {
  const res = Object.create(null);
  if (!dirs) {
    // $flow-disable-line
    return res;
  }
  let i, dir;
  for (i = 0; i < dirs.length; i++) {
    dir = dirs[i];
    if (!dir.modifiers) {
      // $flow-disable-line
      dir.modifiers = emptyModifiers;
    }
    res[getRawDirName(dir)] = dir;
    //def属性，即对应的是$options选项中自定义的directives
    dir.def = resolveAsset(vm.$options, "directives", dir.name, true);
  }
  // $flow-disable-line
  return res;
}

function getRawDirName(dir: VNodeDirective): string {
  //如果有rawName属性，则使用该属性；如果没有，则用name属性和modifiers属性拼接
  return (
    //此处的 modifiers || {} 为冗余代码
    dir.rawName || `${dir.name}.${Object.keys(dir.modifiers || {}).join(".")}`
  );
}

function callHook(dir, hook, vnode, oldVnode, isDestroy) {
  const fn = dir.def && dir.def[hook];
  if (fn) {
    try {
      fn(vnode.elm, dir, vnode, oldVnode, isDestroy);
    } catch (e) {
      handleError(e, vnode.context, `directive ${dir.name} ${hook} hook`);
    }
  }
}
