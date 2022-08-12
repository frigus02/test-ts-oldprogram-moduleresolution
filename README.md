# Test TypeScript program and module resolution cache

Test "custom `tsc`" with watch mode and `ts.SourceFile` cache. It emulates
running 3 builds on the following project structore:

```
/a.ts (imports /module/b.d.ts)
/module/b.d.ts
```

1.  Successful build
2.  Delete file `/module/b.d.ts`. Build fails with error "TS2307: Cannot find
    module"
3.  Restore file `/module/b.d.ts`. Build still fails, but I would expect it to
    succeed again

To reproduce:

```sh
$ npm ci
$ node index.js
```
