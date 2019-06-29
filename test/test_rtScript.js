"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var test_1 = require("./test");
var file = "rtScript/script1.ts";
describe(file, function () {
    test_1.hasLines(file, "import * as Module1 from \"module1\"; Module1.foo();", [
        "var Module1 = require(\"module1\")",
        "Module1.foo()",
    ]);
});
