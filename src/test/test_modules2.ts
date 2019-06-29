import { hasLines } from "./test";

const fileName = "modules/sub/module2.ts";

describe(fileName, () => {

    hasLines(fileName, `const foo = "foo"`, [
        `var modules__sub__module2 = (function () {`,
        `var foo = "foo"`,
        `return {}`,
        `})();`,
    ]);
});
