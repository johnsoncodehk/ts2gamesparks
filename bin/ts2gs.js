#!/usr/bin/env node
const ts2gs = require("../lib/ts2gamesparks.js");
const options = require("yargs")
	.option("init", { alias: "i" })
	.option("useRequireOnce", { boolean: true })
	.argv;

if (options.init) {
	ts2gs.init(process.cwd());
}
else {
	const builder = new ts2gs.Builder(process.cwd(), options);
	builder.buildAllFiles();
}
