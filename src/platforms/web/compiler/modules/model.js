/* @flow */

import { addRawAttr, getBindingAttr, getAndRemoveAttr } from "compiler/helpers";

import {
  processFor,
  processElement,
  addIfCondition,
  createASTElement,
} from "compiler/parser/index";

//处理tag为input，且制定了type属性的元素

//不同input type的功能和行为都是不同的，在此将input添加ifCondition来区分三种不同情况下
//的input，从而区分当前input的功能
/**
 * Expand input[v-model] with dynamic type bindings into v-if-else chains
 * Turn this:
 *   <input v-model="data[type]" :type="type">
 * into this:
 *   <input v-if="type === 'checkbox'" type="checkbox" v-model="data[type]">
 *   <input v-else-if="type === 'radio'" type="radio" v-model="data[type]">
 *   <input v-else :type="type" v-model="data[type]">
 */
function preTransformNode(el: ASTElement, options: CompilerOptions) {
  if (el.tag === "input") {
    const map = el.attrsMap;
    if (!map["v-model"]) {
      return;
    }

    let typeBinding;
    //如果元素绑定了type属性
    if (map[":type"] || map["v-bind:type"]) {
      typeBinding = getBindingAttr(el, "type");
    }
    //如果没有绑定type属性，但是使用了v-bind，同样可能会声明type: v-bind="{ type: this,type }"
    if (!map.type && !typeBinding && map["v-bind"]) {
      //map["v-bind"]即等于{type: this.type}
      typeBinding = `(${map["v-bind"]}).type`;
    }

    //无论用哪一种方式声明了type属性，只要其存在
    if (typeBinding) {
      const ifCondition = getAndRemoveAttr(el, "v-if", true);
      const ifConditionExtra = ifCondition ? `&&(${ifCondition})` : ``;
      const hasElse = getAndRemoveAttr(el, "v-else", true) != null;
      const elseIfCondition = getAndRemoveAttr(el, "v-else-if", true);
      // 1. checkbox
      const branch0 = cloneASTElement(el);
      // process for on the main node
      //在元素的预解析中，并没有用到processOnce，因为对于一个绑定了v-model的input来说，
      //逻辑上本身不存在v-once的情况，因此，设置了也会导致失效

      //预处理元素的v-for
      processFor(branch0);
      //为元素添加属性：type:checkbox
      addRawAttr(branch0, "type", "checkbox");
      //预处理元素的key，ref，v-bind，v-on等等属性
      processElement(branch0, options);

      //！！！此处设置了processed为true，对应在start句法解析函数中在解析if，for
      //once之前会对其进行判断，其作用就时防止预处理的元素再做一次重复的解析
      branch0.processed = true; // prevent it from double-processed
      //ifConditionExtra = ifCondition ? `&&(${ifCondition})` : ``
      //在后续所有情况的type下，判断条件都做了类似的处理，即合并两个条件语句
      branch0.if = `(${typeBinding})==='checkbox'` + ifConditionExtra;
      addIfCondition(branch0, {
        exp: branch0.if,
        block: branch0,
      });
      // 2. add radio else-if condition
      const branch1 = cloneASTElement(el);
      //移除v-for(因为在branch0已经处理，此将被添加至其ifCondition中的元素不需要处理)
      getAndRemoveAttr(branch1, "v-for", true);
      //为元素添加属性type：radio
      addRawAttr(branch1, "type", "radio");
      //处理属性
      processElement(branch1, options);
      //将v-else-if  typeBinding === "radio"的元素添加至branch0的ifCondition中
      addIfCondition(branch0, {
        exp: `(${typeBinding})==='radio'` + ifConditionExtra,
        block: branch1,
      });
      // 3. other
      const branch2 = cloneASTElement(el);
      //移除v-for
      getAndRemoveAttr(branch2, "v-for", true);
      //这里之所以没有为type声明固定的值，是因为经过上述两次处理之后，剩下的情况
      //可以一并处理，因此不再关心type
      //为元素添加属性 :type="typeBinding"
      addRawAttr(branch2, ":type", typeBinding);
      //预处理属性
      processElement(branch2, options);
      //添加ifCondition
      addIfCondition(branch0, {
        exp: ifCondition,
        block: branch2,
      });

      //因为if和else-if的解析差异，若元素本身存在elseIf也不需要像if语句一样每一项
      //都合并判断语句，只需要在其本身上添加elseif属性即可(elseif并不会在自身做判断，
      //其依赖于previousSibling的ifCondition的判断逻辑，因此，只要进入了此元素的解析，
      //必然代表已经符合elseif)
      if (hasElse) {
        branch0.else = true;
      } else if (elseIfCondition) {
        branch0.elseif = elseIfCondition;
      }

      return branch0;
    }
  }
}

function cloneASTElement(el) {
  //对attrsList进行浅拷贝
  return createASTElement(el.tag, el.attrsList.slice(), el.parent);
}

export default {
  preTransformNode,
};
