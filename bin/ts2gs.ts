#!/usr/bin/env node
import * as ts2gs from "../";
import * as yargs from "yargs";

const options = yargs
	.option("init", { alias: "i" })
	.argv;

if (options.init) {
	ts2gs.init(process.cwd());
}
else {
	const builder = ts2gs.createBuilder(process.cwd());
	builder.buildAllFiles();
}
