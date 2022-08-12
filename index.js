const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const STANDARD_TYPINGS = [
  '/node_modules/typescript/lib/lib.es5.d.ts',
  '/node_modules/typescript/lib/lib.es2015.collection.d.ts',
  '/node_modules/typescript/lib/lib.es2015.core.d.ts',
  '/node_modules/typescript/lib/lib.es2015.promise.d.ts',
  '/node_modules/typescript/lib/lib.es2015.iterable.d.ts',
  '/node_modules/typescript/lib/lib.es2015.generator.d.ts',
  '/node_modules/typescript/lib/lib.es2015.symbol.d.ts',
  '/node_modules/typescript/lib/lib.es2015.reflect.d.ts',
  '/node_modules/typescript/lib/lib.es2016.array.include.d.ts',
  '/node_modules/typescript/lib/lib.es2017.object.d.ts',
  '/node_modules/typescript/lib/lib.es2017.string.d.ts',
  '/node_modules/typescript/lib/lib.es2018.asyncgenerator.d.ts',
  '/node_modules/typescript/lib/lib.es2018.asynciterable.d.ts',
  '/node_modules/typescript/lib/lib.es2018.promise.d.ts',
  '/node_modules/typescript/lib/lib.es2019.array.d.ts',
  '/node_modules/typescript/lib/lib.es2019.object.d.ts',
  '/node_modules/typescript/lib/lib.es2019.string.d.ts',
  '/node_modules/typescript/lib/lib.es2019.symbol.d.ts',
  '/node_modules/typescript/lib/lib.es2020.promise.d.ts',
  '/node_modules/typescript/lib/lib.es2020.string.d.ts',
  '/node_modules/typescript/lib/lib.es2021.promise.d.ts',
  '/node_modules/typescript/lib/lib.es2021.string.d.ts',
  '/node_modules/typescript/lib/lib.dom.d.ts',
  '/node_modules/typescript/lib/lib.dom.iterable.d.ts',
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
const ROUNDS = [
  {files: FILES},
  {files: exceptKey(FILES, '/module/b.d.ts')},
  {files: FILES},
];

const COMPILER_OPTIONS = {
  'allowUnreachableCode': false,
  'baseUrl': '/',
  'declaration': true,
  'downlevelIteration': true,
  'emitDecoratorMetadata': true,
  'experimentalDecorators': true,
  'importHelpers': true,
  'inlineSourceMap': true,
  'inlineSources': true,
  'module': ts.ModuleKind.CommonJS,
  'moduleResolution': ts.ModuleResolutionKind.NodeJs,
  'noEmitOnError': false,
  'noErrorTruncation': false,
  'noFallthroughCasesInSwitch': true,
  'noImplicitAny': true,
  'noImplicitOverride': true,
  'noImplicitReturns': true,
  'noImplicitThis': true,
  'noLib': true,
  'noPropertyAccessFromIndexSignature': true,
  'outDir': `${__dirname}/out`,
  'preserveConstEnums': false,
  'rootDir': '/',
  'rootDirs': ['/'],
  'skipDefaultLibCheck': true,
  'sourceMap': false,
  'strictBindCallApply': true,
  'strictFunctionTypes': true,
  'strictNullChecks': true,
  'strictPropertyInitialization': true,
  'stripInternal': true,
  'target': ts.ScriptTarget.ES2020,
  'types': [],
  'useUnknownInCatchVariables': true
};

const FORMAT_DIAGNOSTICS_HOST = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: f => f
};

const EMPTY_FILE_PATH = '/empty.d.ts';

class CompilerHostWithFileCache {
  constructor(delegate, files) {
    this.delegate = delegate;
    this.files = files;
  }

  // ts.CompilerHost
  getSourceFile(
      fileName, languageVersionOrOptions, _onError, shouldCreateNewSourceFile) {
    if (fileName === EMPTY_FILE_PATH) {
      return ts.createSourceFile(fileName, '', languageVersionOrOptions);
    }

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
  getDefaultLibLocation() {
    return path.dirname(
        this.getDefaultLibFileName({target: ts.ScriptTarget.ES5}));
  }
  writeFile(fileName, text, writeByteOrderMark, onError, sourceFiles, _data) {
    if (!fs.existsSync(fileName) ||
        fs.readFileSync(fileName, 'utf-8') !== text) {
      this.delegate.writeFile(
          fileName, text, writeByteOrderMark, onError, sourceFiles);
    }
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
  resolveTypeReferenceDirectives(typeReferenceDirectiveNames) {
    return typeReferenceDirectiveNames.map(() => ({
                                             primary: true,
                                             resolvedFileName: EMPTY_FILE_PATH,
                                           }));
  }

  // ts.ModuleResolutionHost
  fileExists(fileName) {
    return fileName in this.files;
  }
  readFile(fileName) {
    return this.delegate.readFile(fileName);
  }
  trace(s) {
    console.error(s);
  }
  realpath(path) {
    return path;
  }
  getDirectories(path) {
    return this.delegate.getDirectories ? this.delegate.getDirectories(path) :
                                          [];
  }
}

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
