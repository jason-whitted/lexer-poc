const fs = require('fs');

const schema = fs.readFileSync('./test.lex', 'utf8');

const lexer = require('./lexer');

const tokenizer = lexer(schema);

const tokens = tokenizer('abc + 123 + 123.456 + a + 0');

console.log(tokens);
