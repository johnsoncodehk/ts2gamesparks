import { hasLines } from "./test";

const fileName = "events/event1.ts";

describe(fileName, () => {

    hasLines(fileName, `import * as Module1 from "module1";`, [
        `requireOnce("module1")`,
    ], { useRequireOnce: true, });
    hasLines(fileName, `import * as Module1 from "module1";`, [
        `require("module1")`,
    ], { useRequireOnce: false, });

    hasLines(fileName, `import * as Module1 from "module1"; Module1.foo();`, [
        `requireOnce("module1")`,
        `modules__module1.foo()`,
    ]);
    hasLines(fileName, `import { foo } from "module1"; foo();`, [
        `requireOnce("module1")`,
        `modules__module1.foo()`,
    ]);
    hasLines(fileName, `import { foo, bar } from "module1"; foo(); bar();`, [
        `requireOnce("module1")`,
        `modules__module1.foo()`,
        `modules__module1.bar()`,
    ]);
    hasLines(fileName, `import { foo as bar } from "module1"; bar();`, [
        `requireOnce("module1")`,
        `modules__module1.foo()`,
    ]);
});
