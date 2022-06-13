/* @flow */

import config from "core/config";
import { addHandler, addProp, getBindingAttr } from "compiler/helpers";
import {
  genComponentModel,
  genAssignmentCode,
} from "compiler/directives/model";
import { toNumber } from "../../../../shared/util";

let warn;

// in some cases, the event used has to be determined at runtime
// so we used some reserved tokens during compile.
export const RANGE_TOKEN = "__r";
export const CHECKBOX_RADIO_TOKEN = "__c";
// {
//   name: 'model',
//   rawName: 'v-model:[fantasy].happy.sad',
//   value: 'play',
//   arg: 'fantasy',
//   isDynamicArg: true,
//   modifiers:{ happy:true, sad:true }
// }
export default function model(
  el: ASTElement,
  dir: ASTDirective,
  _warn: Function
): ?boolean {
  warn = _warn;
  const value = dir.value;
  const modifiers = dir.modifiers;
  const tag = el.tag;
  //根据input框的type做区别处理
  const type = el.attrsMap.type;

  if (process.env.NODE_ENV !== "production") {
    // inputs with type="file" are read only and setting the input's
    // value will throw an error.
    //如果input框的type设定了file，且绑定了v-model的话，则报错
    if (tag === "input" && type === "file") {
      warn(
        `<${el.tag} v-model="${value}" type="file">:\n` +
          `File inputs are read only. Use a v-on:change listener instead.`,
        el.rawAttrsMap["v-model"]
      );
    }
  }

  //如果元素是动态组件，则解析过后返回false
  if (el.component) {
    //会为component添加model属性，为其他标准控件添加change或input事件，还有checked，value等属性
    genComponentModel(el, value, modifiers);
    // component v-model doesn't need extra runtime
    return false;
    //接下来就是对不同控件的区别处理，其本质上就是绑定事件，实现双向绑定的
    //视图驱动数据更新
  } else if (tag === "select") {
    genSelect(el, value, modifiers);
  } else if (tag === "input" && type === "checkbox") {
    genCheckboxModel(el, value, modifiers);
  } else if (tag === "input" && type === "radio") {
    genRadioModel(el, value, modifiers);
  } else if (tag === "input" || tag === "textarea") {
    genDefaultModel(el, value, modifiers);
    //如果不是保留的tag，即为自定义tag，则将其当作component处理
  } else if (!config.isReservedTag(tag)) {
    genComponentModel(el, value, modifiers);
    // component v-model doesn't need extra runtime
    return false;

    //如果其为保留标签，又不为上述几种情况，则此时不允许绑定v-model，抛出错误
  } else if (process.env.NODE_ENV !== "production") {
    warn(
      `<${el.tag} v-model="${value}">: ` +
        `v-model is not supported on this element type. ` +
        "If you are working with contenteditable, it's recommended to " +
        "wrap a library dedicated for that purpose inside a custom component.",
      el.rawAttrsMap["v-model"]
    );
  }

  // ensure runtime directive metadata
  return true;
}

function genCheckboxModel(
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number;
  //获取checkbox自定义的value
  const valueBinding = getBindingAttr(el, "value") || "null";
  const trueValueBinding = getBindingAttr(el, "true-value") || "true";
  const falseValueBinding = getBindingAttr(el, "false-value") || "false";
  //_i函数：looseIndexOf
  //_VUEs\_vue\src\shared\util.js
  //作用是找到值相同的项(不需要指针相同)，并返回index

  //_q函数：looseEqual，即_i函数：looseIndexOf内部调用的函数
  //_VUEs\_vue\src\shared\util.js
  //会在二者值完全相同的时候返回Boolean

  //为checkbox添加原生属性属性 checked，表达式类似为:
  // Array.isArray(value)? value.indexOf(valueBinding)>-1:value
  addProp(
    el,
    "checked",
    `Array.isArray(${value})` +
      `?_i(${value},${valueBinding})>-1` +
      (trueValueBinding === "true"
        ? `:(${value})`
        : `:_q(${value},${trueValueBinding})`)
  );
  //为checkbox添加change事件
  //其回调函数的表达式为：
  // var $$a = value,
  //   $$el = $event.target,
  //   $$c = $$el.checked ? trueValueBinding : falseValueBinding;
  // if (Array.isArray($$a)) {
  //   var $$v = number ? toNumber(valueBinding) : valueBinding;
  //   var $$i = looseIndexOf($$a, $$v);
  //    如果目标元素被选中，且value数组内此时没有该元素的valueBinding，则添加
  //   if ($$el.checked) {
  //     $$i < 0 && (value = $$a.concat([$$v]));
  //   } else {
  //    如果目标元素没被选中，且value数组内存在该valueBinding，则移除
  //     $$i > -1 && (value = $$a.slice(0, $$i).concat($$a.slice($$i + 1)));
  //   }
  // } else {
  //    简单赋值
  //   value = $$c;
  // }
  addHandler(
    el,
    "change",
    `var $$a=${value},` +
      "$$el=$event.target," +
      `$$c=$$el.checked?(${trueValueBinding}):(${falseValueBinding});` +
      "if(Array.isArray($$a)){" +
      `var $$v=${number ? "_n(" + valueBinding + ")" : valueBinding},` +
      "$$i=_i($$a,$$v);" +
      `if($$el.checked){$$i<0&&(${genAssignmentCode(
        value,
        "$$a.concat([$$v])"
      )})}` +
      `else{$$i>-1&&(${genAssignmentCode(
        value,
        "$$a.slice(0,$$i).concat($$a.slice($$i+1))"
      )})}` +
      `}else{${genAssignmentCode(value, "$$c")}}`,
    null,
    true
  );
}

function genRadioModel(
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number;
  let valueBinding = getBindingAttr(el, "value") || "null";
  //是否将valueBinding做toNumber处理
  valueBinding = number ? `_n(${valueBinding})` : valueBinding;
  //_q函数：looseEqual，即_i函数：looseIndexOf内部调用的函数
  //_VUEs\_vue\src\shared\util.js
  //会在二者值完全相同的时候返回Boolean

  //为radio添加html属性checked
  addProp(el, "checked", `_q(${value},${valueBinding})`);
  //为radio添加change事件，回调的表达式为 value = valueBinding
  //radio只能为单选，并且选择了其中一个，另一个就会自动取消勾选，因此只需要在每次
  //change事件发生时将其重新赋值即可
  addHandler(el, "change", genAssignmentCode(value, valueBinding), null, true);
}

function genSelect(el: ASTElement, value: string, modifiers: ?ASTModifiers) {
  const number = modifiers && modifiers.number;
  //options为选择框的选项，对应着<option>元素
  //selectedVal为select选中的每一项，具体的做法就是从target中的options中
  //过滤出所有selected的项，然后根据这些项是否存在_value，有则返回_value，否则
  //返回value；并且会根据修饰符number对返回的值进行toNumber处理
  const selectedVal =
    `Array.prototype.filter` +
    `.call($event.target.options,function(o){return o.selected})` +
    `.map(function(o){var val = "_value" in o ? o._value : o.value;` +
    `return ${number ? "_n(val)" : "val"}})`;

  //target是否设置了multiple,如是，则将selected的每一项都传值给value，否则则是将选中的
  //第一项传值给value
  const assignment =
    "$event.target.multiple ? $$selectedVal : $$selectedVal[0]";
  let code = `var $$selectedVal = ${selectedVal};`;
  code = `${code} ${genAssignmentCode(value, assignment)}`;
  //为v-model的select框绑定change事件
  //当change事件发生时，会执行code中的代码，即 ： 以v-model="info.name"为例

  //最终触发的代码为：
  //var $$selectedVal = selectedVal(为上述过滤处理的val)
  //info.name = $set(info,name,$event.target.multiple ? $$selectedVal : $$selectedVal[0])

  addHandler(el, "change", code, null, true);
}

function genDefaultModel(
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
): ?boolean {
  const type = el.attrsMap.type;

  // warn if v-bind:value conflicts with v-model
  // except for inputs with v-bind:type
  if (process.env.NODE_ENV !== "production") {
    const value = el.attrsMap["v-bind:value"] || el.attrsMap[":value"];
    const typeBinding = el.attrsMap["v-bind:type"] || el.attrsMap[":type"];
    //如果动态绑定了value，但是没有动态绑定type，则警告v-model和动态绑定的value冲突
    if (value && !typeBinding) {
      const binding = el.attrsMap["v-bind:value"] ? "v-bind:value" : ":value";
      warn(
        `${binding}="${value}" conflicts with v-model on the same element ` +
          "because the latter already expands to a value binding internally",
        el.rawAttrsMap[binding]
      );
    }
  }

  const { lazy, number, trim } = modifiers || {};
  const needCompositionGuard = !lazy && type !== "range";
  //lazy的实现是用change事件，对于input框和textArea来说，change事件会在输入框
  //失去焦点的时候触发，而input事件会在输入的时候触发
  const event = lazy ? "change" : type === "range" ? RANGE_TOKEN : "input";

  let valueExpression = "$event.target.value";
  //如果声明了trim修饰符，则使用trim()事件去除前后空格
  if (trim) {
    valueExpression = `$event.target.value.trim()`;
  }
  //如果声明了number修饰符，则toNumber
  if (number) {
    valueExpression = `_n(${valueExpression})`;
  }

  let code = genAssignmentCode(value, valueExpression);
  if (needCompositionGuard) {
    code = `if($event.target.composing)return;${code}`;
  }
  //为元素添加原生属性value，注意，value包裹上了一层()
  addProp(el, "value", `(${value})`);
  //为元素添加事件，可能为change，也可能为inputW
  addHandler(el, event, code, null, true);
  if (trim || number) {
    //如果声明了trim或number修饰符，会在输入框失焦的时候触发强制更新，使输入框中的
    //内容与实际绑定的value同步

    //详解：
    //正常情况下，页面上的input框若输入了内容，则会通过上述添加的input事件或change事件
    //改变绑定的data的值。

    //但是如果是使用了trim，就会有一下情况产生（以顺序输入 'a', 'c', 'd', ' ', ' '为例）：
    //1，input框输入 a，通过input事件改变data为 a；
    //2，input框输入 c，通过input事件改变data为 ac；
    //3，input框输入 d，通过input事件改变data为 acd；
    //上述三步都会通过响应式原理通知页面update。虽然我也觉得不合理，但事实就是 通过页面改变data最终还是会导致data的响应式去通知Watcher。虽然结果上通过对比发现内容相同，不导致更新，但是逻辑上来看依旧不合理
    //接下来是关键的两步。也就是为什么需要通过blur添加$forceUpdate的原因

    //4，input框输入 ' '，但是value.trim()依旧为acd，因此响应式失效。此时value为'acd '，而data为'abc'；
    //5，input框输入 ' '，但是value.trim()依旧为acd，因此响应式失效。此时value为'acd  '，而data为'abc'；
    //最终，在输入两次空格之后，结果是 input的value改变为'acb  '，而data为'acb'
    //并且此时是无法通过响应式去刷新页面的，因为并未触发。从而现象就是 data与其对应的value不相同

    //此时，添加一个blur事件，就可以最终在输入完成之后，通过强制的刷新，将value再次改变为与data相同的'acb'

    addHandler(el, "blur", "$forceUpdate()");
  }
}
