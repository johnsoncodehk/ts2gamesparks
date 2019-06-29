#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ts2gs = require("../lib");
var yargs = require("yargs");
var options = yargs
    .option("init", { alias: "i" })
    .option("useRequireOnce", { boolean: true })
    .argv;
if (options.init) {
    ts2gs.init(process.cwd());
}
else {
    var builder = ts2gs.createBuilder(process.cwd(), options);
    builder.buildAllFiles();
}
