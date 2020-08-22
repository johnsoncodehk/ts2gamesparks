import * as fs from "fs-extra";
import * as path from "path";
import * as assert from "assert";
import * as ts2gs from "../lib";

export function hasLines(fileName: string, tsCode: string, lines: string[], options?: {}) {
    let title = tsCode;
    if (options) {
        title += " " + JSON.stringify(options);
    }
    describe(title, () => {

        const js = convertToJs(fileName, tsCode, options);

        for (const i in lines) {
            const testLine = lines[i];
            it(testLine, () => {
                assert(js.indexOf(testLine) >= 0, js);
            });
        }
    });
}
function convertToJs(fileName: string, tsCode: string, options?: {}) {

    const dir = fs.mkdtempSync("test_");

    ts2gs.init(dir);

    fileName = path.join(dir, fileName);
    fs.mkdirpSync(path.dirname(fileName));
    fs.writeFileSync(fileName, tsCode);

    const builder = ts2gs.createBuilder(dir, options);
    const js = builder.buildJs(fileName)
        .replace(new RegExp("    ", "g"), "")
        .replace(new RegExp("\n", "g"), " ");

    fs.removeSync(dir);

    return js;
}
