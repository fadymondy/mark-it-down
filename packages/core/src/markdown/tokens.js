"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenize = tokenize;
exports.inlineToText = inlineToText;
const marked_1 = require("marked");
function tokenize(markdown) {
    return marked_1.marked.lexer(markdown);
}
function inlineToText(tokens) {
    if (!tokens)
        return '';
    return tokens.map(tokenToText).join('');
}
function tokenToText(token) {
    const t = token;
    switch (t.type) {
        case 'text':
            return t.text ?? '';
        case 'escape':
            return t.text ?? '';
        case 'codespan':
            return t.text ?? '';
        case 'strong':
        case 'em':
        case 'del':
            return inlineToText(t.tokens);
        case 'link':
            return `${inlineToText(t.tokens)} (${t.href ?? ''})`.trim();
        case 'image':
            return t.title ?? t.text ?? '';
        case 'br':
            return '\n';
        default:
            if (Array.isArray(t.tokens)) {
                return inlineToText(t.tokens);
            }
            return t.text ?? '';
    }
}
//# sourceMappingURL=tokens.js.map