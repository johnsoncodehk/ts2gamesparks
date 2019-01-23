## Installing

### Install ts2gamesparks
```
npm install -g git+https://github.com/johnsoncodehk/ts2gamesparks.git
```

### Install GameSparks typings
```
npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-cloud-code-api-typings.git
npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-realtime-api-typings.git
npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-request-api-typings.git
```

### Init tsconfig files
```
mkdir src
cd src
ts2gs --init
```
These three files will be created:
- src/tsconfig.json
- src/rtScript/tsconfig.json
- src/rtModules/tsconfig.json

If you are not sure, please do not modify these files.

## Using

### Import module

```typescript
// path: src/modules/moduleA

// do it
import * as ModuleA from "moduleA";
import { funcA } from "moduleA";

// don't do it
import * as ModuleA from "./moduleA";
import * as ModuleA from "../modules/moduleA";
import { funcA } from "./moduleA";
import { funcA } from "../modules/moduleA";
```

### Output javascript
```
cd src
ts2gs
```

## Example
https://github.com/johnsoncodehk/gamesparks-cloud-code-typescript-example
