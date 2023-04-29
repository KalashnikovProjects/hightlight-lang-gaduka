'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var python = require('@lezer/python');
var language = require('@codemirror/language');
var common = require('@lezer/common');
var autocomplete = require('@codemirror/autocomplete');

const cache = new common.NodeWeakMap();
const ScopeNodes = new Set([
    "Script", "Body",
    "FunctionDefinition", "ClassDefinition", "LambdaExpression",
    "ForStatement", "MatchClause"
]);
function defID(type) {
    return (node, def, outer) => {
        if (outer)
            return false;
        let id = node.node.getChild("VariableName");
        if (id)
            def(id, type);
        return true;
    };
}
const gatherCompletions = {
    FunctionDefinition: defID("function"),
    ClassDefinition: defID("class"),
    ForStatement(node, def, outer) {
        if (outer)
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name == "VariableName")
                    def(child, "variable");
                else if (child.name == "in")
                    break;
            }
    },
    ImportStatement(_node, def) {
        var _a, _b;
        let { node } = _node;
        let isFrom = ((_a = node.firstChild) === null || _a === void 0 ? void 0 : _a.name) == "from";
        for (let ch = node.getChild("import"); ch; ch = ch.nextSibling) {
            if (ch.name == "VariableName" && ((_b = ch.nextSibling) === null || _b === void 0 ? void 0 : _b.name) != "as")
                def(ch, isFrom ? "variable" : "namespace");
        }
    },
    AssignStatement(node, def) {
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name == "VariableName")
                def(child, "variable");
            else if (child.name == ":" || child.name == "AssignOp")
                break;
        }
    },
    ParamList(node, def) {
        for (let prev = null, child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name == "VariableName" && (!prev || !/\*|AssignOp/.test(prev.name)))
                def(child, "variable");
            prev = child;
        }
    },
    CapturePattern: defID("variable"),
    AsPattern: defID("variable"),
    __proto__: null
};
function getScope(doc, node) {
    let cached = cache.get(node);
    if (cached)
        return cached;
    let completions = [], top = true;
    function def(node, type) {
        let name = doc.sliceString(node.from, node.to);
        completions.push({ label: name, type });
    }
    node.cursor(common.IterMode.IncludeAnonymous).iterate(node => {
        if (node.name) {
            let gather = gatherCompletions[node.name];
            if (gather && gather(node, def, top) || !top && ScopeNodes.has(node.name))
                return false;
            top = false;
        }
        else if (node.to - node.from > 8192) {
            // Allow caching for bigger internal nodes
            for (let c of getScope(doc, node.node))
                completions.push(c);
            return false;
        }
    });
    cache.set(node, completions);
    return completions;
}
const Identifier = /^[\w\xa1-\uffff][\w\d\xa1-\uffff]*$/;
const dontComplete = ["String", "FormatString", "Comment", "PropertyName"];
/// Completion source that looks up locally defined names in
/// Python code.
function localCompletionSource(context) {
    let inner = language.syntaxTree(context.state).resolveInner(context.pos, -1);
    if (dontComplete.indexOf(inner.name) > -1)
        return null;
    let isWord = inner.name == "VariableName" ||
        inner.to - inner.from < 20 && Identifier.test(context.state.sliceDoc(inner.from, inner.to));
    if (!isWord && !context.explicit)
        return null;
    let options = [];
    for (let pos = inner; pos; pos = pos.parent) {
        if (ScopeNodes.has(pos.name))
            options = options.concat(getScope(context.state.doc, pos));
    }
    return {
        options,
        from: isWord ? inner.from : context.pos,
        validFor: Identifier
    };
}
const globals = [
    "Верно", "Ничего", "Неверно"
].map(n => ({ label: n, type: "constant" })).concat([].map(n => ({ label: n, type: "type" }))).concat([
    "копия", "словарь", "десятичная_дробь", "диапазон", "число", "список",
    "Ничего", "пронумеровать", "кортеж", "тип"
].map(n => ({ label: n, type: "class" }))).concat([
    "модуль", "корень", "округлить", "все", "любой", "сумма", "длина", "наибольшее", "все_элементы",
    "наименьшее", "отсортировать", "случайное_число", "случайный_элемент", "разделить_строку",
].map(n => ({ label: n, type: "function" })));
const snippets = [
    // snip("def ${name}(${params}):\n\t${}", {
    //   label: "def",
    //   detail: "function",
    //   type: "keyword"
    // }),
    autocomplete.snippetCompletion("повтор ${name} раз:\n\t${}", {
        label: "for",
        detail: "loop",
        type: "keyword"
    }),
    autocomplete.snippetCompletion("пока ${}:\n\t${}", {
        label: "while",
        detail: "loop",
        type: "keyword"
    }),
    // snip("try:\n\t${}\nexcept ${error}:\n\t${}", {
    //   label: "try",
    //   detail: "/ except block",
    //   type: "keyword"
    // }),
    autocomplete.snippetCompletion("если ${}:\n\t\n", {
        label: "if",
        detail: "block",
        type: "keyword"
    }),
    autocomplete.snippetCompletion("если ${}:\n\t${}\nиначе:\n\t${}", {
        label: "if",
        detail: "/ else block",
        type: "keyword"
    }),
    autocomplete.snippetCompletion("${commands}: ${}, ", {
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
];
/// Autocompletion for built-in Python globals and keywords.
const globalCompletion = autocomplete.ifNotIn(dontComplete, autocomplete.completeFromList(globals.concat(snippets)));

function indentBody(context, node) {
    let base = context.lineIndent(node.from);
    let line = context.lineAt(context.pos, -1), to = line.from + line.text.length;
    // Don't consider blank, deindented lines at the end of the
    // block part of the block
    if (/^\s*($|#)/.test(line.text) &&
        context.node.to < to + 100 &&
        !/\S/.test(context.state.sliceDoc(to, context.node.to)) &&
        context.lineIndent(context.pos, -1) <= base)
        return null;
    // A normally deindenting keyword that appears at a higher
    // indentation than the block should probably be handled by the next
    // level
    if (/^\s*(иначе:|иначе если )/.test(context.textAfter) && context.lineIndent(context.pos, -1) > base)
        return null;
    return base + context.unit;
}
/// A language provider based on the [Lezer Python
/// parser](https://github.com/lezer-parser/python), extended with
/// highlighting and indentation information.
const pythonLanguage = language.LRLanguage.define({
    name: "python",
    parser: python.parser.configure({
        props: [
            language.indentNodeProp.add({
                Body: context => { var _a; return (_a = indentBody(context, context.node)) !== null && _a !== void 0 ? _a : context.continue(); },
                IfStatement: cx => /^\s*(иначе:|иначе если )/.test(cx.textAfter) ? cx.baseIndent : cx.continue(),
                TryStatement: cx => cx.continue(),
                Script: context => {
                    if (context.pos + /\s*/.exec(context.textAfter)[0].length >= context.node.to) {
                        let endBody = null;
                        for (let cur = context.node, to = cur.to;;) {
                            cur = cur.lastChild;
                            if (!cur || cur.to != to)
                                break;
                            if (cur.type.name == "Body")
                                endBody = cur;
                        }
                        if (endBody) {
                            let bodyIndent = indentBody(context, endBody);
                            if (bodyIndent != null)
                                return bodyIndent;
                        }
                    }
                    return context.continue();
                }
            }),
            language.foldNodeProp.add({
                "": language.foldInside,
                Body: (node, state) => ({ from: node.from + 1, to: node.to - (node.to == state.doc.length ? 0 : 1) })
            })
        ],
    }),
    languageData: {
        closeBrackets: {
            brackets: ["(", "[", "{", "'", '"', "'''", '"""'],
            stringPrefixes: ["f", "fr", "rf", "r", "u", "b", "br", "rb",
                "F", "FR", "RF", "R", "U", "B", "BR", "RB"]
        },
        commentTokens: { line: "#" },
        indentOnInput: /^\s*([\}\]\)]|иначе:|иначе если )$/
    }
});
/// Python language support.
function gaduka() {
    return new language.LanguageSupport(pythonLanguage, [
        pythonLanguage.data.of({ autocomplete: localCompletionSource }),
        pythonLanguage.data.of({ autocomplete: globalCompletion }),
    ]);
}

exports.gaduka = gaduka;
exports.globalCompletion = globalCompletion;
exports.localCompletionSource = localCompletionSource;
exports.pythonLanguage = pythonLanguage;
