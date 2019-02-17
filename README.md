## Installing

### Install ts2gamesparks
```
$ npm install -g git+https://github.com/johnsoncodehk/ts2gamesparks.git
```

### Install GameSparks typings
```
$ npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-cloud-code-api-typings.git
$ npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-realtime-api-typings.git
$ npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-request-api-typings.git
```

### Init tsconfig files
```
$ mkdir src && cd src
$ ts2gs --init
```
These three files will be created:
- src/tsconfig.json
- src/rtScript/tsconfig.json
- src/rtModules/tsconfig.json

If you are not sure, please do not modify these files.

## Using

### Export something
:warning: Do not use export in directories other than modules and rtModules
```typescript
// src/modules/myModule.ts

export function foo() {
	return "foo";
}
export const bar = "bar"
```

### Import something

```typescript
// do it
import * as MyModule from "myModule";
import { foo } from "myModule";

// don't do it!
import * as MyModule from "./myModule";
import * as MyModule from "../modules/myModule";
import { foo } from "./myModule";
import { foo } from "../modules/myModule";
```

### Prevent global namespace pollution
If the script does not import or export anything, the script will not be recognized as a module, and the variables in the script will exist in the global namespace.
In order to solve it, just add ```export { }``` to the first line of the script.

### Output javascript
When tsconfig.json under root directory
```
$ ts2gs
```
When tsconfig.json under ./src
```
$ cd src && ts2gs
```

## Example
https://github.com/johnsoncodehk/gamesparks-cloud-code-typescript-example
