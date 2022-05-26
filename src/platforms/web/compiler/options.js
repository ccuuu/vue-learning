/* @flow */

import {
  isPreTag,
  mustUseProp,
  isReservedTag,
  getTagNamespace,
} from "../util/index";

import modules from "./modules/index";
import directives from "./directives/index";
import { genStaticKeys } from "shared/util";
import { isUnaryTag, canBeLeftOpenTag } from "./util";

export const baseOptions: CompilerOptions = {
  expectHTML: true,
  modules,
  directives,
  //通过给定的标签名字检查标签是否是 'pre' 标签。
  isPreTag,
  //检测给定的标签是否是一元标签。
  isUnaryTag,
  //用来检测一个属性在标签中是否要使用 props 进行绑定。
  mustUseProp,
  //检测一个标签是否是那些虽然不是一元标签，但却可以自己补全并闭合的标签。比如 p 标签
  //是一个双标签，你需要这样使用 <p>Some content</p>，但是你依然可以省略闭合标签，直
  //接这样写：<p>Some content，且浏览器会自动补全。但是有些标签你不可以这样用，它们是
  //严格的双标签。
  canBeLeftOpenTag,
  //检查给定的标签是否是保留的标签。（HTML标签或SVG相关标签）
  isReservedTag,
  //获取元素(标签)的命名空间。
  getTagNamespace,
  //根据编译器选项的 modules 选项生成一个静态键字符串。
  staticKeys: genStaticKeys(modules),
};
