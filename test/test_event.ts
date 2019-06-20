import test from "./test";

const fileName = "events/event1.ts";

describe(fileName, () => {

    test(fileName, `import * as Module1 from "module1"; Module1.foo();`, [
        `requireOnce("module1")`,
        `modules__module1.foo()`,
    ]);
    test(fileName, `import { foo } from "module1"; foo();`, [
        `requireOnce("module1")`,
        `modules__module1.foo()`,
    ]);
    test(fileName, `import { foo, bar } from "module1"; foo(); bar();`, [
        `requireOnce("module1")`,
        `modules__module1.foo()`,
        `modules__module1.bar()`,
    ]);
});
