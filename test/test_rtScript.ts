import test from "./test";

const file = "rtScript/script1.ts";

describe(file, () => {

    test(file, `import * as Module1 from "module1"; Module1.foo();`, [
        `var Module1 = require("module1")`,
        `Module1.foo()`,
    ]);
});
