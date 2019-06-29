"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var test_1 = require("./test");
var fileName = "events/event1.ts";
describe(fileName, function () {
    test_1.hasLines(fileName, "import * as Module1 from \"module1\";", [
        "requireOnce(\"module1\")",
    ], { useRequireOnce: true, });
    test_1.hasLines(fileName, "import * as Module1 from \"module1\";", [
        "require(\"module1\")",
    ], { useRequireOnce: false, });
    test_1.hasLines(fileName, "import * as Module1 from \"module1\"; Module1.foo();", [
        "requireOnce(\"module1\")",
        "modules__module1.foo()",
    ]);
    test_1.hasLines(fileName, "import { foo } from \"module1\"; foo();", [
        "requireOnce(\"module1\")",
        "modules__module1.foo()",
    ]);
    test_1.hasLines(fileName, "import { foo, bar } from \"module1\"; foo(); bar();", [
        "requireOnce(\"module1\")",
        "modules__module1.foo()",
        "modules__module1.bar()",
    ]);
    test_1.hasLines(fileName, "import { foo as bar } from \"module1\"; bar();", [
        "requireOnce(\"module1\")",
        "modules__module1.foo()",
    ]);
});
