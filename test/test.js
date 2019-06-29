"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs-extra");
var path = require("path");
var assert = require("assert");
var ts2gs = require("../lib");
function hasLines(fileName, tsCode, lines, options) {
    var title = tsCode;
    if (options) {
        title += " " + JSON.stringify(options);
    }
    describe(title, function () {
        var js = convertToJs(fileName, tsCode, options);
        var _loop_1 = function (i) {
            var testLine = lines[i];
            it(testLine, function () {
                assert(js.indexOf(testLine) >= 0, js);
            });
        };
        for (var i in lines) {
            _loop_1(i);
        }
    });
}
exports.hasLines = hasLines;
function convertToJs(fileName, tsCode, options) {
    var dir = fs.mkdtempSync("test_");
    ts2gs.init(dir);
    fileName = path.join(dir, fileName);
    fs.mkdirpSync(path.dirname(fileName));
    fs.writeFileSync(fileName, tsCode);
    var builder = ts2gs.createBuilder(dir, options);
    var js = builder.buildJs(fileName)
        .replace(new RegExp("    ", "g"), "")
        .replace(new RegExp("\n", "g"), " ");
    fs.removeSync(dir);
    return js;
}
