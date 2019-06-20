import * as fs from "fs-extra";
import * as path from "path";
import * as assert from "assert";
import * as ts2gs from "../lib/ts2gamesparks";

export default function hasLines(fileName: string, tsCode: string, testLines: string[]) {
    describe(tsCode, () => {
        
        const js = covertToJs(fileName, tsCode);
    
        for (const i in testLines) {
            const testLine = testLines[i];
            it(testLine, () => {
                assert(js.indexOf(testLine) >= 0, js);
            });
        }
    });
}
function covertToJs(fileName: string, tsCode: string) {

    const cwd = fs.mkdtempSync("test_");
    ts2gs.init(cwd);

    fileName = path.join(cwd, fileName);
    fs.mkdirpSync(path.dirname(fileName));
    fs.writeFileSync(fileName, tsCode);

    const builder = ts2gs.createBuilder(cwd);
    const js = builder.covertFile(fileName)
        .replace(new RegExp("    ", "g"), "")
        .replace(new RegExp("\n", "g"), " ");

    fs.removeSync(cwd);

    return js;
}
