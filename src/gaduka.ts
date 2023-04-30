const {parser} = require("@lezer/python");
const {SyntaxNode} = require("@lezer/common");
const {delimitedIndent, indentNodeProp, TreeIndentContext, 
        foldNodeProp, foldInside, LRLanguage, LanguageSupport} = require("@codemirror/language");
const {globalCompletion, localCompletionSource} = require("./complete");

function indentBody(context, node) {
  let base = context.lineIndent(node.from)
  let line = context.lineAt(context.pos, -1), to = line.from + line.text.length
  if (/^\s*($|#)/.test(line.text) &&
      context.node.to < to + 100 &&
      !/\S/.test(context.state.sliceDoc(to, context.node.to)) &&
      context.lineIndent(context.pos, -1) <= base)
    return null
  if (/^\s*(иначе:|иначе если )/.test(context.textAfter) && context.lineIndent(context.pos, -1) > base)
    return null
  return base + context.unit
}

const pythonLanguage = LRLanguage.define({
  name: "gaduka",
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Body: context => indentBody(context, context.node) ?? context.continue(),
        IfStatement: cx => /^\s*(иначе:|иначе если )/.test(cx.textAfter) ? cx.baseIndent : cx.continue(),
        TryStatement: cx => cx.continue(),
        Script: context => {
          if (context.pos + /\s*/.exec(context.textAfter)![0].length >= context.node.to) {
            let endBody = null
            for (let cur = context.node, to = cur.to;;) {
              cur = cur.lastChild
              if (!cur || cur.to != to) break
              if (cur.type.name == "Body") endBody = cur
            }
            if (endBody) {
              let bodyIndent = indentBody(context, endBody)
              if (bodyIndent != null) return bodyIndent
            }
          }
          return context.continue()
        }
      }),
      foldNodeProp.add({
        "": foldInside,
        Body: (node, state) => ({from: node.from + 1, to: node.to - (node.to == state.doc.length ? 0 : 1)})
      })
    ],
  }),
  languageData: {
    closeBrackets: {
      brackets: ["(", "[", "{", "'", '"', "'''", '"""'],
      stringPrefixes: ["f", "fr", "rf", "r", "u", "b", "br", "rb",
                       "F", "FR", "RF", "R", "U", "B", "BR", "RB"]
    },
    commentTokens: {line: "#"},
    indentOnInput: /^\s*([\}\]\)]|иначе:|иначе если )$/
  }
});

function gaduka() {
  return new LanguageSupport(pythonLanguage, [
    pythonLanguage.data.of({autocomplete: localCompletionSource}),
    pythonLanguage.data.of({autocomplete: globalCompletion}),
  ]);
}

module.exports = { gaduka, globalCompletion, localCompletionSource };