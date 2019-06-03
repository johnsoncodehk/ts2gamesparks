#!/usr/bin/env node
const ts2gs = require('../lib/ts2gamesparks.js')
const ts = require("typescript");

if (ts.sys.args.length == 0) {
	ts2gs.build(process.cwd());
}
else {
	const commandLine = ts.parseCommandLine(ts.sys.args);
	if (commandLine.options.init) {
		ts2gs.init(process.cwd());
	}
}
