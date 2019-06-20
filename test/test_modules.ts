import test from "./test";

const fileName = "modules/module1.ts";

describe(fileName, () => {

    test(fileName, `const foo = "foo"`, [
        `var modules__module1 = (function () {`,
        `var foo = "foo"`,
        `return {}`,
        `})();`,
    ]);
    test(fileName, `export const foo = "foo"; function bar() { return "bar"; };`, [
        `var foo = "foo"`,
        `function bar() { return "bar"; }`,
        `return { foo: foo }`,
    ]);
    test(fileName, `export const foo = "foo"; export function bar() { return "bar"; };`, [
        `var foo = "foo"`,
        `function bar() { return "bar"; }`,
        `return { foo: foo, bar: bar }`,
    ]);
    test(fileName, `import * as Module2 from "module2"; export const foo = Module2.foo;`, [
        `requireOnce("module2")`,
        `var foo = modules__module2.foo`,
        `return { foo: foo }`,
    ]);
});
