/* @flow */

import { isObject, isDef, hasSymbol } from "core/util/index";

/**
 * Runtime helper for rendering v-for lists.
 */
export function renderList(
  val: any,
  render: (val: any, keyOrIndex: string | number, index?: number) => VNode
): ?Array<VNode> {
  //val即为v-for中的遍历对象
  let ret: ?Array<VNode>, i, l, keys, key;
  //如果val是一个string，则用for循环遍历触发render的回调函数。
  //其中，参数alias为字符串的下标项，iterator1为下标
  if (Array.isArray(val) || typeof val === "string") {
    ret = new Array(val.length);
    for (i = 0, l = val.length; i < l; i++) {
      ret[i] = render(val[i], i);
    }
    //如果val是一个number，则for循环number触发回调函数
    //其中，参数alias为1，2，3，4...，iterator1为下标
  } else if (typeof val === "number") {
    ret = new Array(val);
    for (i = 0; i < val; i++) {
      ret[i] = render(i + 1, i);
    }
    //如果val是一个object
  } else if (isObject(val)) {
    //如果其是一个可迭代对象([@iterator]为可迭代接口，拥有此迭代接口的即为可迭代对象)

    if (hasSymbol && val[Symbol.iterator]) {
      ret = [];
      //用可迭代接口生成一个迭代器对象
      const iterator: Iterator<any> = val[Symbol.iterator]();
      //通过迭代器对象的next()循环整个迭代器，并触发回调

      //之所以这么做是为了不去该变迭代行为。特别是自定义了迭代接口的某个对象
      //永远用迭代器来控制回调的触发

      //参数为迭代中的返回值value，以及index(ret.length就是上一项的length，对应的
      //等于当前项的index)
      let result = iterator.next();
      while (!result.done) {
        ret.push(render(result.value, ret.length));
        result = iterator.next();
      }
    } else {
      //否则，就是一个不可迭代对象。
      //则用Object.keys获取其keys的数组，并for循环这个数组，并触发回调

      //参数：值，键，keys的索引
      keys = Object.keys(val);
      ret = new Array(keys.length);
      for (i = 0, l = keys.length; i < l; i++) {
        key = keys[i];
        ret[i] = render(val[key], key, i);
      }
    }
  }
  if (!isDef(ret)) {
    ret = [];
  }
  //将ret加上_isVList属性，将来会在生成vNode的时候利用此属性为其动态生成key
  (ret: any)._isVList = true;
  return ret;
}
