/* @flow */

const validDivisionCharRE = /[\w).+\-_$\]]/;

//为了正确处理过滤器  :key="name | filterName", 不能简单地以 | 分割，理由如下：
//:key="'name | filterName'"
//:key="`name | filterName`"
//:key="name || filterName"
//:key="/id|featId/.test(id).toString()"
//以上场景都不应该将变量当作过滤器处理
export function parseFilters(exp: string): string {
  //单引号
  let inSingle = false;
  //双引号
  let inDouble = false;
  //模板字符串
  let inTemplateString = false;
  //正则
  let inRegex = false;
  //{}。遇到 { 加一，遇到 } 减一
  let curly = 0;
  //[]。遇到 [ 加一，遇到 ] 减一
  let square = 0;
  //()。遇到 ( 加一，遇到 ) 减一
  let paren = 0;
  let lastFilterIndex = 0;
  let c, prev, i, expression, filters;

  for (i = 0; i < exp.length; i++) {
    prev = c;
    c = exp.charCodeAt(i);
    if (inSingle) {
      //当前字符是单引号(')，并且当前字符的前一个字符不是转义字符(\)
      if (c === 0x27 && prev !== 0x5c) inSingle = false;
    } else if (inDouble) {
      //当前字符是双引号(")，并且当前字符的前一个字符不是转义字符(\)
      if (c === 0x22 && prev !== 0x5c) inDouble = false;
    } else if (inTemplateString) {
      //当前字符是模板字符(`)，并且当前字符的前一个字符不是转义字符(\)
      if (c === 0x60 && prev !== 0x5c) inTemplateString = false;
    } else if (inRegex) {
      //当前字符是斜杠(/)，并且当前字符的前一个字符不是转义字符(\)
      if (c === 0x2f && prev !== 0x5c) inRegex = false;
    } else if (
      //如果当前检索的字符是 | ，并且其相邻位置不为 | (为了防止 || )，
      //且其不能处于花括号、方括号、圆括号之内
      c === 0x7c && // pipe
      exp.charCodeAt(i + 1) !== 0x7c &&
      exp.charCodeAt(i - 1) !== 0x7c &&
      !curly &&
      !square &&
      !paren
    ) {
      if (expression === undefined) {
        // first filter, end of expression
        lastFilterIndex = i + 1;
        //将需要过滤器处理的变量的key放在expression
        expression = exp.slice(0, i).trim();
      } else {
        pushFilter();
      }
    } else {
      switch (c) {
        case 0x22:
          inDouble = true;
          break; // "
        case 0x27:
          inSingle = true;
          break; // '
        case 0x60:
          inTemplateString = true;
          break; // `
        case 0x28:
          paren++;
          break; // (
        case 0x29:
          paren--;
          break; // )
        case 0x5b:
          square++;
          break; // [
        case 0x5d:
          square--;
          break; // ]
        case 0x7b:
          curly++;
          break; // {
        case 0x7d:
          curly--;
          break; // }
      }
      //此处是为了区分正则表达式和除法
      //0x2f对应 (/)
      if (c === 0x2f) {
        // /
        let j = i - 1;
        let p;
        // find first non-whitespace prev char
        for (; j >= 0; j--) {
          p = exp.charAt(j);
          //如果存在不为空字符串的字符
          if (p !== " ") break;
        }
        //如果/的前方都为空字符或没有字符
        //validDivisionCharRE：字母、数字、)、.、+、-、_、$、]
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true;
        }
      }
    }
  }
  //如果expression为undefined，则代表在检索中并未找到过滤器的管道符，则变量就为整个
  //value
  if (expression === undefined) {
    expression = exp.slice(0, i).trim();
  } else if (lastFilterIndex !== 0) {
    //将最后一次的过滤器放入filters中
    pushFilter();
  }

  function pushFilter() {
    (filters || (filters = [])).push(exp.slice(lastFilterIndex, i).trim());
    //为了处理多个过滤器的情况
    lastFilterIndex = i + 1;
  }

  //如果有过滤器
  if (filters) {
    //循环执行每一个过滤器
    for (i = 0; i < filters.length; i++) {
      //如果：:key="name | filter1 | filter2 | filter3"
      //则express为name，filters为[filter1,filter2,filter3]
      //执行过程如下：
      //第一次执行：express = `_f("filter1")(name)`
      //第二次执行：express = `_f("filter2")(_f("filter1")(name))`
      //第三次执行：express = `_f("filter3")(_f("filter2")(_f("filter1")(name)))`

      //如果 :key="name | filter1(a) | filter2(b) | filter3()"
      //第一次执行：express = `_f("filter1")(name,a)`
      //第二次执行：express = `_f("filter2")(_f("filter1")(name,a),b)`
      //第三次执行：express = `_f("filter3")(_f("filter2")(_f("filter1")(name,a),b))`
      expression = wrapFilter(expression, filters[i]);
    }
  }

  return expression;
}

function wrapFilter(exp: string, filter: string): string {
  const i = filter.indexOf("(");
  if (i < 0) {
    // _f: resolveFilter
    return `_f("${filter}")(${exp})`;
  } else {
    const name = filter.slice(0, i);
    const args = filter.slice(i + 1);
    return `_f("${name}")(${exp}${args !== ")" ? "," + args : args}`;
  }
}
