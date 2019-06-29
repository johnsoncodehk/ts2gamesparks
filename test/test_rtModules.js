"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var test_1 = require("./test");
var file = "rtModules/module1.ts";
describe(file, function () {
    test_1.hasLines(file, "import * as Module2 from \"module2\"; export const foo = Module2.foo;", [
        "var Module2 = require(\"module2\")",
        "exports.foo = Module2.foo",
    ]);
});
