/* @flow */

import config from "core/config";

import {
  warn,
  isObject,
  toObject,
  isReservedAttribute,
  camelize,
  hyphenate,
} from "core/util/index";

/**
 * Runtime helper for merging v-bind="object" into a VNode's data.
 */
export function bindObjectProps(
  data: any,
  tag: string,
  value: any,
  asProp: boolean,
  isSync?: boolean
): VNodeData {
  if (value) {
    //v-bind只支持绑定对象
    if (!isObject(value)) {
      process.env.NODE_ENV !== "production" &&
        warn("v-bind without argument expects an Object or Array value", this);
    } else {
      if (Array.isArray(value)) {
        value = toObject(value);
      }
      let hash;
      for (const key in value) {
        if (key === "class" || key === "style" || isReservedAttribute(key)) {
          hash = data;
        } else {
          //如果声明了prop修饰符，或者属性为mustUseProp的属性，则为其添加至domProps中
          //否则将其添加至attrs中
          const type = data.attrs && data.attrs.type;
          hash =
            asProp || config.mustUseProp(tag, type, key)
              ? data.domProps || (data.domProps = {})
              : data.attrs || (data.attrs = {});
        }
        //以上操作为不同情况下的key指定不同的hash，可能为data，也可能为data.domProps，或data.attrs

        //驼峰
        const camelizedKey = camelize(key);
        //连字符
        const hyphenatedKey = hyphenate(key);
        //如果都不在，则将其添加
        if (!(camelizedKey in hash) && !(hyphenatedKey in hash)) {
          hash[key] = value[key];

          if (isSync) {
            //如果使用了sync修饰符，则额外添加update事件
            const on = data.on || (data.on = {});
            on[`update:${key}`] = function ($event) {
              value[key] = $event;
            };
          }
        }
      }
    }
  }
  return data;
}
