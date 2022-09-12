// Copyright 2022 Google LLC.
// SPDX-License-Identifier: Apache-2.0

const fs = require('fs');
const {resolveTypeReferenceDirective} = require('typescript');
const ts = require('typescript');

const STANDARD_TYPINGS = [
  '/node_modules/typescript/lib/lib.es5.d.ts',
  '/node_modules/typescript/lib/lib.dom.d.ts',
];

const FILES = {
  '/a.ts':
      'import * as lib from "./m/lib";\n\nconsole.log(lib.GLOBAL_VAR.toLowerCase());\n',
  '/b.ts':
      'import * as lib from "./m/lib";\n\nconsole.log(lib.GLOBAL_VAR.toLowerCase());\n',
  '/m/lib.d.ts': 'export {GLOBAL_VAR} from "./transitive_lib";\n',
  '/m/transitive_lib.d.ts': 'export const GLOBAL_VAR = 1.1;\n',
  '/m/transitive_lib/index.d.ts': 'export const GLOBAL_VAR = "hello";\n',
};
for (const file of STANDARD_TYPINGS) {
  FILES[file] = fs.readFileSync('.' + file, 'utf8');
}

const SOURCE_FILE_CACHE = new Map();
const SOURCE_FILE_REG =
    ts.createDocumentRegistry(/* useCaseSensitiveFileNames */ true);
const PROGRAM_CACHE = new Map();

function exceptKey(obj, keyToRemove) {
  return Object.fromEntries(
      Object.entries(obj).filter(([key]) => key !== keyToRemove));
}

const COMPILER_OPTIONS = {
  'module': ts.ModuleKind.CommonJS,
  'moduleResolution': ts.ModuleResolutionKind.NodeJs,
  'noLib': true,
  'outDir': `${__dirname}/out`,
  'strict': true,
  'target': ts.ScriptTarget.ES2020,
};

const FORMAT_DIAGNOSTICS_HOST = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getCanonicalFileName: f => f,
  getNewLine: () => ts.sys.newLine,
};

class CompilerHostWithFileCache {
  constructor(delegate, files, options) {
    this.delegate = delegate;
    this.files = files;
    this.options = options;
  }

  getCompilationSettings() {
    return this.options;
  }

  getSourceFile(
      fileName, languageVersionOrOptions, _onError, shouldCreateNewSourceFile) {
    if (!this.fileExists(fileName)) {
      return undefined;
    }

    const key = fileName + '|' +
        SOURCE_FILE_REG.getKeyForCompilationSettings(
            this.getCompilationSettings());

    if (SOURCE_FILE_CACHE.has(key)) {
      if (shouldCreateNewSourceFile) {
        const newSourceFile = SOURCE_FILE_REG.updateDocument(
            fileName, this, ts.ScriptSnapshot.fromString(this.files[fileName]),
            '1');
        SOURCE_FILE_CACHE.set(key, newSourceFile);
        return newSourceFile;
      }

      return SOURCE_FILE_CACHE.get(key);
    }

    const sourceFile = SOURCE_FILE_REG.acquireDocument(
        fileName, this, ts.ScriptSnapshot.fromString(this.files[fileName]),
        '1');
    SOURCE_FILE_CACHE.set(key, sourceFile);

    return sourceFile;
  }

  getDefaultLibFileName(options) {
    return this.delegate.getDefaultLibFileName(options);
  }

  writeFile(fileName, text, writeByteOrderMark, onError, sourceFiles, data) {
    this.delegate.writeFile(
        fileName, text, writeByteOrderMark, onError, sourceFiles, data);
  }

  getCurrentDirectory() {
    return '/';
  }

  getCanonicalFileName(path) {
    return path;
  }

  useCaseSensitiveFileNames() {
    return true;
  }

  getNewLine() {
    return '\n';
  }

  fileExists(fileName) {
    return fileName in this.files;
  }

  readFile(fileName) {
    return this.files[fileName];
  }
}

const ROUNDS = [
  // Fails: A uses transitive_lib.d.ts, which exports a number, which doesn't
  // have a toLowerCase() method.
  {
    programKey: 'A',
    files: FILES,
    rootFileNames: [...STANDARD_TYPINGS, '/a.ts'],
  },
  // Works: B doesn't have transitive_lib.d.ts, so it loads
  // transitive_lib/index.d.ts, which exports a string, which does have a
  // toLowerCase() method.
  {
    programKey: 'B',
    files: exceptKey(FILES, '/m/transitive_lib.d.ts'),
    rootFileNames: [...STANDARD_TYPINGS, '/b.ts'],
  },
  // Should fail but works
  {
    programKey: 'A',
    files: FILES,
    rootFileNames: [...STANDARD_TYPINGS, '/a.ts'],
  },
];

for (const [i, round] of ROUNDS.entries()) {
  console.log(`ROUND ${i} START`);

  const compilerHost = new CompilerHostWithFileCache(
      ts.createCompilerHost(COMPILER_OPTIONS), round.files, COMPILER_OPTIONS);
  const oldProgram = PROGRAM_CACHE.get(round.programKey);
  const program = ts.createProgram(
      round.rootFileNames, COMPILER_OPTIONS, compilerHost, oldProgram);
  PROGRAM_CACHE.set(round.programKey, program);
  const mainSourceFiles = program.getSourceFiles().filter(
      sf => round.rootFileNames.includes(sf.fileName) &&
          !STANDARD_TYPINGS.includes(sf.fileName));

  const diagnostics = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];
  for (const sf of mainSourceFiles) {
    diagnostics.push(...program.getSyntacticDiagnostics(sf));
    diagnostics.push(...program.getSemanticDiagnostics(sf));
    diagnostics.push(...program.emit(sf).diagnostics);
  }
  if (diagnostics.length > 0) {
    console.log(ts.formatDiagnostics(diagnostics, FORMAT_DIAGNOSTICS_HOST));
  }
}
