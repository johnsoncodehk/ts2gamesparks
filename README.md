## Installing

### Install ts2gamesparks
```console
$ npm install -g git+https://github.com/johnsoncodehk/ts2gamesparks.git
```

### Install GameSparks typings
Requirement
```console
$ npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-cloud-code-api-typings.git
$ npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-request-api-typings.git
```
Optional
```console
$ npm install --save-dev git+https://github.com/johnsoncodehk/gamesparks-realtime-api-typings.git
```

### Init tsconfig files
```console
$ mkdir src && cd src
$ ts2gs --init
```
These three files will be created:
- src/tsconfig.json
- src/rtScript/tsconfig.json
- src/rtModules/tsconfig.json

If you are not sure, please do not modify these files.

## Using

### Prevent global namespace pollution
If the script does not import or export anything, the script will not be recognized as a module, and the variables in the script will exist in the global namespace.
In order to solve it, just add ```export { }``` to the first line of the script.

### Export something
:warning: Do not use export in directories other than ```modules/``` and ```rtModules/```
```typescript
// src/modules/foo.ts

export function func() {
	/* ... */
}
export const bar = "bar"
```

### Import something
:white_check_mark: Do it
```typescript
import /* ... */ from "foo";
```
:x: Don't do it!
```typescript
import /* ... */ from "./foo";
import /* ... */ from "../modules/foo";
```

### Output javascript
When tsconfig.json under root directory
```console
$ ts2gs
```
When tsconfig.json under ./src
```console
$ cd src && ts2gs
```

## Example
https://github.com/johnsoncodehk/gamesparks-cloud-code-typescript-example
