// Copyright 2022 Google LLC.
// SPDX-License-Identifier: Apache-2.0

const fs = require('fs');
const ts = require('typescript');

const STANDARD_TYPINGS = [
  '/node_modules/typescript/lib/lib.es5.d.ts',
  '/node_modules/typescript/lib/lib.dom.d.ts',
];

const FILES = {
  '/a.ts': 'import * as b from "./module/b";\n\nconsole.log(b.GLOBAL_VAR);\n',
  '/module/b.d.ts': 'export const GLOBAL_VAR = "StringValueFromB";\n',
};
for (const file of STANDARD_TYPINGS) {
  FILES[file] = fs.readFileSync('.' + file, 'utf8');
}

const CACHE = new Map();

function exceptKey(obj, keyToRemove) {
  return Object.fromEntries(
      Object.entries(obj).filter(([key]) => key !== keyToRemove));
}

const ROOT_FILE_NAMES =
    Object.keys(FILES).filter(key => key !== '/module/b.d.ts');

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
  constructor(delegate, files) {
    this.delegate = delegate;
    this.files = files;
  }

  getSourceFile(
      fileName, languageVersionOrOptions, _onError, shouldCreateNewSourceFile) {
    if (!this.fileExists(fileName)) {
      return undefined;
    }

    if (CACHE.has(fileName) && !shouldCreateNewSourceFile) {
      return CACHE.get(fileName);
    }

    const sourceFile = ts.createSourceFile(
        fileName, this.files[fileName], languageVersionOrOptions);
    CACHE.set(fileName, sourceFile);
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
    return this.delegate.getCurrentDirectory();
  }

  getCanonicalFileName(path) {
    return this.delegate.getCanonicalFileName(path);
  }

  useCaseSensitiveFileNames() {
    return this.delegate.useCaseSensitiveFileNames();
  }

  getNewLine() {
    return this.delegate.getNewLine();
  }

  fileExists(fileName) {
    return fileName in this.files;
  }

  readFile(fileName) {
    return this.delegate.readFile(fileName);
  }
}

const ROUNDS = [
  // Initial successful build
  {files: FILES},
  // Emulate file b.d.ts being deleted --> should error
  {files: exceptKey(FILES, '/module/b.d.ts')},
  // Emulate file b.d.ts being restored --> should succeed but errors
  {files: FILES},
];

let oldProgram;
for (const [i, round] of ROUNDS.entries()) {
  console.log(`ROUND ${i} START`);

  const compilerHost = new CompilerHostWithFileCache(
      ts.createCompilerHost(COMPILER_OPTIONS), round.files);
  const program = ts.createProgram(
      ROOT_FILE_NAMES, COMPILER_OPTIONS, compilerHost, oldProgram);
  oldProgram = program;
  const mainFileNames =
      ROOT_FILE_NAMES.filter(fileName => !fileName.startsWith('/node_modules'))
  const mainSourceFiles = program.getSourceFiles().filter(
      sf => mainFileNames.includes(sf.fileName));

  const diagnostics = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];
  for (const sf of mainSourceFiles) {
    diagnostics.push(...program.getSyntacticDiagnostics(sf));
    diagnostics.push(...program.getSemanticDiagnostics(sf));
  }
  if (diagnostics.length > 0) {
    console.log(ts.formatDiagnostics(diagnostics, FORMAT_DIAGNOSTICS_HOST));
    continue;
  }
  for (const sf of mainSourceFiles) {
    diagnostics.push(...program.emit(sf).diagnostics);
  }
  if (diagnostics.length > 0) {
    console.log(ts.formatDiagnostics(diagnostics, FORMAT_DIAGNOSTICS_HOST));
  }
}
