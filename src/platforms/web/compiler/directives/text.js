/* @flow */

import { addProp } from "compiler/helpers";

export default function text(el: ASTElement, dir: ASTDirective) {
  if (dir.value) {
    //_s函数为toString
    //会为将v-text指令最终解析为一个名为textContent的HTML属性
    addProp(el, "textContent", `_s(${dir.value})`, dir);
  }
}
