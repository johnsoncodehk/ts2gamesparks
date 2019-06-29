import { hasLines } from "./test";

const file = "rtModules/module1.ts";

describe(file, () => {

    hasLines(file, `import * as Module2 from "module2"; export const foo = Module2.foo;`, [
        `var Module2 = require("module2")`,
        `exports.foo = Module2.foo`,
    ]);
});
