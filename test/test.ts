import * as fs from "fs-extra";
import * as path from "upath";
import * as assert from "assert";
import * as ts2gs from "../";

export function hasLines(fileName: string, tsCode: string, lines: string[]) {
    let title = tsCode;
    describe(title, () => {

        const js = convertToJs(fileName, tsCode);

        for (const i in lines) {
            const testLine = lines[i];
            it(testLine, () => {
                assert(js.indexOf(testLine) >= 0, js);
            });
        }
    });
}
function convertToJs(fileName: string, tsCode: string) {

    const dir = fs.mkdtempSync("test_");

    ts2gs.init(dir);

    fileName = path.join(dir, fileName);
    fs.mkdirpSync(path.dirname(fileName));
    fs.writeFileSync(fileName, tsCode);

    const builder = ts2gs.createBuilder(dir);
    const js = builder.buildJs(fileName)
        .replace(new RegExp("    ", "g"), "")
        .replace(new RegExp("\r\n", "g"), " ")
        .replace(new RegExp("\n", "g"), " ")

    fs.removeSync(dir);

    return js;
}
