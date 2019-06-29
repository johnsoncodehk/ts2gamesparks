"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var test_1 = require("./test");
var fileName = "modules/sub/module2.ts";
describe(fileName, function () {
    test_1.hasLines(fileName, "const foo = \"foo\"", [
        "var modules__sub__module2 = (function () {",
        "var foo = \"foo\"",
        "return {}",
        "})();",
    ]);
});
