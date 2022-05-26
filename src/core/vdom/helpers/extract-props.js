/* @flow */

import {
  tip,
  hasOwn,
  isDef,
  isUndef,
  hyphenate,
  formatComponentName,
} from "core/util/index";

export function extractPropsFromVNodeData(
  data: VNodeData,
  Ctor: Class<Component>,
  tag?: string
): ?Object {
  // we are only extracting raw values here.
  // validation and default values are handled in the child
  // component itself.
  //propOptions指向选项中的props，即父组件向该子组件所传递的值
  const propOptions = Ctor.options.props;
  if (isUndef(propOptions)) {
    return;
  }
  const res = {};
  const { attrs, props } = data;
  if (isDef(attrs) || isDef(props)) {
    //遍历每一个options中的props，并将其结果存放在res中
    for (const key in propOptions) {
      //altKey为连字符形式
      const altKey = hyphenate(key);
      if (process.env.NODE_ENV !== "production") {
        const keyInLowerCase = key.toLowerCase();
        if (
          //如果key不为纯小写，并且attr存在此key，则tip
          key !== keyInLowerCase &&
          attrs &&
          hasOwn(attrs, keyInLowerCase)
        ) {
          tip(
            `Prop "${keyInLowerCase}" is passed to component ` +
              `${formatComponentName(
                tag || Ctor
              )}, but the declared prop name is` +
              ` "${key}". ` +
              `Note that HTML attributes are case-insensitive and camelCased ` +
              `props need to use their kebab-case equivalents when using in-DOM ` +
              `templates. You should probably use "${altKey}" instead of "${key}".`
          );
        }
      }
      //如果前者已有，则会返回true，这时就不会进入第二个check中。
      //本质上，就是先check props属性，若没有，再去check attrs属性
      checkProp(res, props, key, altKey, true) ||
        checkProp(res, attrs, key, altKey, false);
    }
  }
  return res;
}

function checkProp(
  res: Object,
  hash: ?Object,
  key: string,
  altKey: string,
  preserve: boolean
): boolean {
  //preserve只有对于attrs来说，才会为false；
  //这就意味着当check到attrs的时候，若发现了某个属性与options中的props相对应
  //则会从attrs中取出这个属性，并删除。
  //但是对于props来说，则会保留，不会删除
  if (isDef(hash)) {
    if (hasOwn(hash, key)) {
      res[key] = hash[key];
      if (!preserve) {
        delete hash[key];
      }
      return true;
    } else if (hasOwn(hash, altKey)) {
      res[key] = hash[altKey];
      if (!preserve) {
        delete hash[altKey];
      }
      return true;
    }
  }
  return false;
}
