function* reader(text) {
  let line = 1;
  let column = 0;

  let previous, current;
  for (var i = 0; i < text.length; i++) {
    previous = current;
    current = text[i];
    if (previous === '\n') {
      line++;
      column = 0;
    }
    column++;
    yield { current, location: { line, column, charIndex: i } };
  }
}

const tokenizer = scheme => {
  const stream = reader(scheme);

  const tokens = [];

  let state = 0;
  let cursor;
  let tokenText;
  let tokenPosition;

  const token = (type, other) => ({ type, text: tokenText, location: tokenLocation, ...other });

  const next = () => {
    cursor = stream.next();
  };
  next();

  const space = c => /\s/.test(c);
  const digit = c => /\d/.test(c);
  const alpha = c => /[a-z]/i.test(c);

  const go = step => {
    tokenText += cursor.value.current;
    next();
    state = step;
  };

  const constants = ':?!()[]*';

  /*
  ":" "?" "!" "(" ")" "[" "]" "*"
  "lookup"  :: alpha+
  "number"  :: digit+
  "regex"   :: /expr/opts
  "string"  :: "..." | '...'
  */

  while (!cursor.done) {
    const { current, location } = cursor.value;

    switch (state) {
      case 0:
        tokenText = '';
        tokenLocation = location;
        if (constants.includes(current)) {
          go(0);
          tokens.push(token(current));
        } else if (space(current)) {
          go(0);
        } else if (alpha(current)) {
          go(10);
        } else if (digit(current)) {
          go(20);
        } else if (current === '/') {
          go(30);
        } else if (current === '"') {
          go(40);
        } else if (current === "'") {
          go(50);
        } else {
          go(0);
          tokens.push(token('unknown', { invalid: true }));
        }
        break;
      case 10: // lookup
        if (alpha(current)) {
          go(10);
        } else {
          tokens.push(token('lookup'));
          state = 0;
        }
        break;
      case 20: // number
        if (digit(current)) {
          go(20);
        } else {
          tokens.push(token('number'));
          state = 0;
        }
        break;
      case 30: // regex
        if (current === '\\') {
          go(31);
        } else if (current === '/') {
          go(32);
        } else if (current) {
          go(30);
        } else {
          go(0);
          tokens.push(token('regex', { invalid: true }));
        }
        break;
      case 31: // regex: escaped character
        if (current) {
          go(30);
        } else {
          tokens.push(token('regex', { invalid: true }));
          state = 0;
        }
        break;
      case 32: // regex: ending
        if ('gimuy'.includes(current)) {
          go(32);
        } else {
          tokens.push(token('regex'));
          state = 0;
        }
        break;
      case 40: // string (")
        if (current === '\\') {
          go(41);
        } else if (current === '"') {
          go(0);
          tokens.push(token('string'));
        } else if (current) {
          go(40);
        } else {
          go(0);
          tokens.push(token('string', { invalid: true }));
        }
        break;
      case 41: // string: escaped character
        if (current) {
          go(40);
        } else {
          tokens.push(token('string', { invalid: true }));
          state = 0;
        }
        break;
      case 50: // string (')
        if (current === '\\') {
          go(51);
        } else if (current === "'") {
          go(0);
          tokens.push(token('string'));
        } else if (current) {
          go(50);
        } else {
          go(0);
          tokens.push(token('string', { invalid: true }));
        }
        break;
      case 51: // string: escaped character
        if (current) {
          go(50);
        } else {
          tokens.push(token('string', { invalid: true }));
        }
        break;
      default:
        go(0);
        tokens.push(token('unknown', { invalid: true }));
        break;
    }
  }

  const reg = /\/(.+)\/([gimuy]*)/i;
  const reformat = t => {
    switch (t.type) {
      case 'regex': {
        if (!t.invalid) {
          const [, expr, opts] = t.text.match(reg);
          t.value = new RegExp(expr, opts);
        }
        break;
      }
      case 'number':
        t.value = parseInt(t.text, 10);
        break;
      case 'string':
        if (!t.invalid) {
          t.value = t.text.slice(1, t.text.length - 1);
        }
        break;
    }
    return t;
  };

  return tokens.concat(token('eof')).map(reformat);
};

const assembler = ({ variables, steps, refs, errors, warnings }) => {
  const fn = code => {
    const tokens = [];
    // TODO: Tokenize their code
    return tokens;
  };
  fn.variables = variables;
  fn.steps = steps;
  fn.refs = refs;
  fn.errors = errors;
  fn.warnings = warnings;
  return fn;
};

const compiler = scheme => {
  const tokens = tokenizer(scheme);

  let current;
  const next = () => {
    current = tokens.shift();
  };
  next();

  /*
  compile :: varList stepList
  varList :: variable varList | e
  variable :: "lookup" ":" ("regex" | "string")
  stepList :: step stepList | e
  step :: stepID ":" actionList (stepID | tokenID)
  stepID :: "(" "number" ")"
  tokenID :: "!"? "[" "string" "]"
  actionList :: action actionList | e
  action :: condition "?" (stepID | tokenID) | e
  condition :: "lookup" | "string" | "regex" | "*" | e
  */

  const variables = {};
  const steps = {};
  const refs = { variables: [], steps: [] };
  const errors = [];
  const warnings = [];

  const error = (text, other) => ({ text, location: current.location, ...other });
  const addRef = type => (id, location = current.location) => {
    if (!refs[type].some(s => s.id === id)) refs[type].push({ id, location });
  };

  const compile = depth => {
    varList(depth + 1);
    stepList(depth + 1);
    if (current.type !== 'eof') {
      errors.push(error('Expected end of file'));
    }
  };

  const varList = depth => {
    const result = variable(depth + 1);
    if (result) {
      const { key } = result;
      if (!variables.hasOwnProperty(key)) {
        variables[key] = result;
      } else {
        errors.push(`Variable '${key}' is already defined`);
      }
      varList(depth + 1);
    }
  };

  const variable = depth => {
    let result;
    if (current.type === 'lookup') {
      const { text: key, location } = current;
      next();
      if (current.type === ':') {
        next();
        if (current.type === 'regex' || current.type === 'string') {
          const { value } = current;
          next();
          return { key, value, location };
        } else {
          errors.push(error(`Expected variable '${key}' to be string or regex`));
        }
      } else {
        errors.push(error('Expected :'));
      }
    }
    return result;
  };

  const stepList = depth => {
    const result = step(depth + 1);
    if (result) {
      const { id } = result;
      if (!steps.hasOwnProperty(id)) {
        steps[id] = result;
      } else {
        errors.push(error(`Step ${id} is already defined`));
      }
      stepList(depth + 1);
    }
  };

  const step = depth => {
    const stp = stepID(depth + 1);
    if (stp !== undefined) {
      const { id } = stp;
      if (current.type === ':') {
        next();
        const actions = actionList(depth + 1);

        let fallback = stepID(depth + 1);
        if (fallback !== undefined) {
          addRef('steps')(fallback.id);
          return { ...stp, actions, fallback: { type: 'step', id: fallback } };
        }

        fallback = tokenID(depth + 1);
        if (fallback !== undefined) {
          return { ...stp, actions, fallback: { type: 'token', id: fallback } };
        } else {
          errors.push(error('Expected (step) or [token]'));
        }
      } else {
        errors.push(error('Expected :'));
      }
    }
  };

  const stepID = depth => {
    let result;
    if (current.type === '(') {
      next();
      if (current.type === 'number') {
        result = { type: 'step', id: current.value, location: current.location };
        next();
        if (current.type === ')') {
          next();
        } else {
          errors.push(error('Expected )'));
        }
      } else {
        errors.push(error('Expected step number'));
      }
    }
    return result;
  };

  const tokenID = depth => {
    let result;

    const bang = current.type === '!';
    if (bang) {
      next();
    }

    if (current.type === '[') {
      next();
      if (current.type === 'string') {
        result = { type: 'token', id: current.value, error: bang, location: current.location };
        next();
        if (current.type === ']') {
          next();
        } else {
          errors.push(error('Expected ]'));
        }
      } else {
        errors.push(error('Expected token string'));
      }
    }

    return result;
  };

  const actionList = depth => {
    let result;
    const a = action(depth + 1);
    if (a) {
      result = [a];
      const more = actionList(depth + 1);
      if (more) {
        result = result.concat(more);
      }
    }
    return result;
  };

  const action = depth => {
    const cond = condition(depth + 1);
    if (cond) {
      if (current.type === '?') {
        next();

        const stp = stepID(depth + 1);
        if (stp !== undefined) {
          addRef('steps')(stp.id, stp.location);
          return { condition: cond, ...stp };
        }

        const tok = tokenID(depth + 1);
        if (tok) {
          return { condition: cond, ...tok };
        } else {
          errors.push(error('Expected (step) or [token]'));
        }
      } else {
        errors.push(error('Expected ?'));
      }
    }
  };

  const condition = depth => {
    if (current.type === 'lookup') {
      const v = variables[current.text];
      if (v) {
        addRef('variables')(current.text);
        next();
        const { value } = v;
        if (typeof value === 'string') {
          return c => c === value;
        } else if (value instanceof RegExp) {
          return c => value && value.test(c);
        } else {
          // NOTE: Already reported an error
          return c => false;
        }
      } else {
        errors.push(error(`Variable '${current.text}' is not defined`));
      }
    } else if (current.type === 'string') {
      const { value } = current;
      next();
      return c => c === value;
    } else if (current.type === 'regex') {
      const { value } = current;
      next();
      return c => value && value.test(regex);
    } else if (current.type === '*') {
      next();
      return c => true;
    }
  };

  const result = compile(0);

  // TODO: WARNINGS: Validate refs
  Object.keys(variables)
    .filter(k => !refs.variables.some(v => v.id === k))
    .forEach(k =>
      warnings.push(error(`Variable '${k}' is declared but never used`, { location: variables[k].location })),
    );
  Object.keys(steps)
    .filter(k => !refs.steps.some(v => v.id == k))
    .forEach(k => warnings.push(error(`Step ${k} is declared but never used`, { location: steps[k].location })));
  refs.steps
    .filter(s => !steps[s.id])
    .forEach(({ id, location }) => warnings.push(error(`Step ${id} is declared but never used`, { location })));

  if (process.env.NODE_ENV !== 'production') {
    const notify = ({ text, location: { line, column } }) => console.log(text, `- line ${line}, column ${column}`);
    if (errors.length) {
      console.group('ERRORS!');
      errors.forEach(notify);
      console.groupEnd();
    }

    if (warnings.length) {
      console.group('Warnings:');
      warnings.forEach(notify);
      console.groupEnd();
    }
  }

  return assembler({ variables, steps, refs, errors, warnings });
};

module.exports = scheme => {
  return compiler(scheme);
};
