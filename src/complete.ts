import {NodeWeakMap, SyntaxNodeRef, SyntaxNode, IterMode} from "@lezer/common"
import {Completion, CompletionContext, CompletionResult, completeFromList, ifNotIn,
        snippetCompletion as snip} from "@codemirror/autocomplete"
import {syntaxTree} from "@codemirror/language"
import {Text} from "@codemirror/state"

const cache = new NodeWeakMap<readonly Completion[]>()

const ScopeNodes = new Set([
  "Script", "Body",
  "FunctionDefinition", "ClassDefinition", "LambdaExpression",
  "ForStatement", "MatchClause"
])

type commands = "добавить текст" | "добавить изображение" | "добавить элемент" | "убрать элемент" |
    "удалить элемент" | "расширить список" | "удалить ключ" | "обрезать изображение" | "сжать изображение" |
    "повернуть изображение" | "отразить изображение" | "наложить эффект" | "наложить текст" | "наложить картинку" |
    "наложить линию" | "наложить многоугольник" | "наложить прямоугольник" | "наложить круг";

function defID(type: string) {
  return (node: SyntaxNodeRef, def: (node: SyntaxNodeRef, type: string) => void, outer: boolean) => {
    if (outer) return false
    let id = node.node.getChild("VariableName")
    if (id) def(id, type)
    return true
  }
}

const gatherCompletions: {
  [node: string]: (node: SyntaxNodeRef, def: (node: SyntaxNodeRef, type: string) => void, outer: boolean) => void | boolean
} = {
  FunctionDefinition: defID("function"),
  ClassDefinition: defID("class"),
  ForStatement(node, def, outer) {
    if (outer) for (let child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name == "VariableName") def(child, "variable")
      else if (child.name == "in") break
    }
  },
  ImportStatement(_node, def) {
    let {node} = _node
    let isFrom = node.firstChild?.name == "from"
    for (let ch = node.getChild("import"); ch; ch = ch.nextSibling) {
      if (ch.name == "VariableName" && ch.nextSibling?.name != "as")
        def(ch, isFrom ? "variable" : "namespace")
    }
  },
  AssignStatement(node, def) {
    for (let child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name == "VariableName") def(child, "variable")
      else if (child.name == ":" || child.name == "AssignOp") break
    }
  },
  ParamList(node, def) {
    for (let prev = null, child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name == "VariableName" && (!prev || !/\*|AssignOp/.test(prev.name)))
        def(child, "variable")
      prev = child
    }
  },
  CapturePattern: defID("variable"),
  AsPattern: defID("variable"),
  __proto__: null as any
}

function getScope(doc: Text, node: SyntaxNode) {
  let cached = cache.get(node)
  if (cached) return cached

  let completions: Completion[] = [], top = true
  function def(node: SyntaxNodeRef, type: string) {
    let name = doc.sliceString(node.from, node.to)
    completions.push({label: name, type})
  }
  node.cursor(IterMode.IncludeAnonymous).iterate(node => {
    if (node.name) {
      let gather = gatherCompletions[node.name]
      if (gather && gather(node, def, top) || !top && ScopeNodes.has(node.name)) return false
      top = false
    } else if (node.to - node.from > 8192) {
      // Allow caching for bigger internal nodes
      for (let c of getScope(doc, node.node)) completions.push(c)
      return false
    }
  })
  cache.set(node, completions)
  return completions
}

const Identifier = /^[\w\xa1-\uffff][\w\d\xa1-\uffff]*$/

const dontComplete = ["String", "FormatString", "Comment", "PropertyName"]

/// Completion source that looks up locally defined names in
/// Python code.
export function localCompletionSource(context: CompletionContext): CompletionResult | null {
  let inner = syntaxTree(context.state).resolveInner(context.pos, -1)
  if (dontComplete.indexOf(inner.name) > -1) return null
  let isWord = inner.name == "VariableName" ||
    inner.to - inner.from < 20 && Identifier.test(context.state.sliceDoc(inner.from, inner.to))
  if (!isWord && !context.explicit) return null
  let options: Completion[] = []
  for (let pos: SyntaxNode | null = inner; pos; pos = pos.parent) {
    if (ScopeNodes.has(pos.name)) options = options.concat(getScope(context.state.doc, pos))
  }
  return {
    options,
    from: isWord ? inner.from : context.pos,
    validFor: Identifier
  }
}

const globals: readonly Completion[] = [
  "Верно", "Ничего", "Неверно"
].map(n => ({label: n, type: "constant"})).concat([
].map(n => ({label: n, type: "type"}))).concat([
  "копия", "словарь", "десятичная_дробь", "диапазон", "число", "список",
  "Ничего", "пронумеровать", "кортеж", "тип"
].map(n => ({label: n, type: "class"}))).concat([
  "модуль", "корень", "округлить", "все", "любой", "сумма", "длина", "наибольшее", "все_элементы",
  "наименьшее", "отсортировать", "случайное_число", "случайный_элемент", "разделить_строку",
].map(n => ({label: n, type: "function"})))

export const snippets: readonly Completion[] = [
  // snip("def ${name}(${params}):\n\t${}", {
  //   label: "def",
  //   detail: "function",
  //   type: "keyword"
  // }),
  snip("повтор ${name} раз:\n\t${}", {
    label: "for",
    detail: "loop",
    type: "keyword"
  }),
  snip("пока ${}:\n\t${}", {
    label: "while",
    detail: "loop",
    type: "keyword"
  }),
  // snip("try:\n\t${}\nexcept ${error}:\n\t${}", {
  //   label: "try",
  //   detail: "/ except block",
  //   type: "keyword"
  // }),
  snip("если ${}:\n\t\n", {
    label: "if",
    detail: "block",
    type: "keyword"
  }),
  snip("если ${}:\n\t${}\nиначе:\n\t${}", {
    label: "if",
    detail: "/ else block",
    type: "keyword"
  }),
  snip("${commands}: ${}, ", {
    label: "class",
    detail: "definition",
    type: "keyword"
  }),
  // snip("import ${module}", {
  //   label: "import",
  //   detail: "statement",
  //   type: "keyword"
  // }),
  // snip("from ${module} import ${names}", {
  //   label: "from",
  //   detail: "import",
  //   type: "keyword"
  // })
]

/// Autocompletion for built-in Python globals and keywords.
export const globalCompletion = ifNotIn(dontComplete, completeFromList(globals.concat(snippets)))
