/* @flow */

/**
 * Cross-platform code generation for component v-model
 */
export function genComponentModel(
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
): ?boolean {
  const { number, trim } = modifiers || {};

  //$$v只是作为最终生成的callBack函数的形参
  const baseValueExpression = "$$v";
  let valueExpression = baseValueExpression;
  if (trim) {
    valueExpression =
      `(typeof ${baseValueExpression} === 'string'` +
      `? ${baseValueExpression}.trim()` +
      `: ${baseValueExpression})`;
  }
  //如果声明了number修饰符，则将其做toNumber处理
  //_n即为parseFloat
  if (number) {
    valueExpression = `_n(${valueExpression})`;
  }
  const assignment = genAssignmentCode(value, valueExpression);

  // {
  //   value:`'information[name]'`,
  //   expression:JSON.stringify('information[name]'),
  //   callback: `function ($$v) {
  //     information[name] =
  //       $set(information,name,typeof $$v === 'string'? $$v.trim():$$v) }`
  // }
  el.model = {
    value: `(${value})`,
    expression: JSON.stringify(value),
    callback: `function (${baseValueExpression}) {${assignment}}`,
  };
}

/**
 * Cross-platform codegen helper for generating v-model value assignment code.
 */
export function genAssignmentCode(value: string, assignment: string): string {
  const res = parseModel(value);
  //如果res存在key，即 v-model="information.name"或者v-model="information[name]"
  if (res.key === null) {
    //将assignment(即控件绑定的value)赋值给value(表达式中的value，上例中的information)
    return `${value}=${assignment}`;
  } else {
    //如果有key，则做$set处理
    //这么做的原因是防止绑定的key并未在data中声明，若此时简单的赋值，则不会被observe
    //会导致响应式的问题
    return `$set(${res.exp}, ${res.key}, ${assignment})`;
  }
}

/**
 * Parse a v-model expression into a base path and a final key segment.
 * Handles both dot-path and possible square brackets.
 *
 * Possible cases:
 *
 * - test
 * - test[key]
 * - test[test1[key]]
 * - test["a"][key]
 * - xxx.test[a[a].test1[key]]
 * - test.xxx.a["asa"][test1[key]]
 *
 */

let len, str, chr, index, expressionPos, expressionEndPos;

type ModelParseResult = {
  exp: string,
  key: string | null,
};

export function parseModel(val: string): ModelParseResult {
  // Fix https://github.com/vuejs/vue/pull/7730
  // allow v-model="obj.val " (trailing whitespace)
  val = val.trim();
  len = val.length;

  //如果从头检索不到[，或从后检索到的]不在末尾位置
  if (val.indexOf("[") < 0 || val.lastIndexOf("]") < len - 1) {
    //找到 . 的位置
    index = val.lastIndexOf(".");
    //如果存在 .
    if (index > -1) {
      //则此时代表该value存在着key，即 v-model = "information.name.shortName"
      //将val转换为对象形式，以上述为例：
      // {
      //   exp: 'information',
      //   key: '"name.shortName"'
      // }
      return {
        exp: val.slice(0, index),
        key: '"' + val.slice(index + 1) + '"',
      };
      //如果不存在 .
      //则设置key为null
    } else {
      return {
        exp: val,
        key: null,
      };
    }
  }

  //进入此行代码，则代表表达式中存在着[]，
  str = val;
  //expressionPos为[]的起始位置，expressionEndPos为[]的终点位置
  index = expressionPos = expressionEndPos = 0;

  //!index >= len
  while (!eof()) {
    //chr为此位置字符对应的ASCII码
    chr = next();
    /* istanbul ignore if */
    //如果是 " 或者 '
    if (isStringStart(chr)) {
      parseString(chr);
      //如果是 [
    } else if (chr === 0x5b) {
      parseBracket(chr);
    }
  }
  //如： v-model = "information[name]"
  //最终处理为{
  //   exp: 'information',
  //   key:'name'
  // }
  //但是如果使用了多个[], 如 v-model = "information[name][firstName]"
  //最终key为最后一个最外层的[]：
  // {
  //   exp: "information[name]",
  //   key: "firstName"
  // }
  return {
    exp: val.slice(0, expressionPos),
    key: val.slice(expressionPos + 1, expressionEndPos),
  };
}

function next(): number {
  return str.charCodeAt(++index);
}

function eof(): boolean {
  return index >= len;
}

//如果匹配ASCII码对应的字符是 " 或者 '
function isStringStart(chr: number): boolean {
  return chr === 0x22 || chr === 0x27;
}

function parseBracket(chr: number): void {
  let inBracket = 1;
  expressionPos = index;
  while (!eof()) {
    chr = next();
    //如果是 " 或者 '
    if (isStringStart(chr)) {
      //则跳过""或''内的内容
      parseString(chr);
      continue;
    }
    //如果是[ ， 则inBracket加一
    if (chr === 0x5b) inBracket++;
    //如果是]，则inBracket减一
    if (chr === 0x5d) inBracket--;
    //如果此时inBracket为0，即[]已被循环完毕
    if (inBracket === 0) {
      //将expressionEndPos刷新为最新的index
      expressionEndPos = index;
      break;
    }
  }
}

//一直循环到下一个相同的字符，即 " 循环至 " ， ' 循环至 '
function parseString(chr: number): void {
  const stringQuote = chr;
  while (!eof()) {
    chr = next();
    if (chr === stringQuote) {
      break;
    }
  }
}
