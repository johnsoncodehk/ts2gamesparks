import * as fs from "fs-extra";
import * as path from "upath";

export function init(dir: string) {
    const tsconfig = {
        "compilerOptions": {
            "target": "es5",
            "module": "commonjs",
            "lib": ["es5", "es2015"],
            "forceConsistentCasingInFileNames": true,
            "rootDir": "./",
            "outDir": "../dist/",
            "baseUrl": "./modules/"
        }
    }
    const tsconfig_rt = {
        "extends": "../tsconfig.json",
        "compilerOptions": {
            "baseUrl": "../rtModules/"
        }
    }

    function tryWriteConfig(fileName: string, tsconfig: any) {
        const filePath = path.join(dir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(tsconfig, undefined, 2));
        }
        else {
            console.log(filePath + " is already defined");
        }
    }

    fs.mkdirpSync(dir);
    tryWriteConfig("tsconfig.json", tsconfig);

    fs.mkdirpSync(path.join(dir, "rtModules"));
    tryWriteConfig("rtModules/tsconfig.json", tsconfig_rt);

    fs.mkdirpSync(path.join(dir, "rtScript"));
    tryWriteConfig("rtScript/tsconfig.json", tsconfig_rt);
}
