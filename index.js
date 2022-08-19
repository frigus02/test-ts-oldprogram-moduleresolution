// Copyright 2022 Google LLC.
// SPDX-License-Identifier: Apache-2.0

const fs = require('fs');
const path = require('path');
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

function exceptKey(obj, keyToRemove) {
  return Object.fromEntries(
      Object.entries(obj).filter(([key]) => key !== keyToRemove));
}

const ROOT_FILE_NAMES =
    Object.keys(FILES).filter(key => key !== '/module/b.d.ts');

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  noLib: true,
  outDir: `${__dirname}/out`,
  strict: true,
  target: ts.ScriptTarget.ES2020,
};

const FORMAT_DIAGNOSTICS_HOST = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getCanonicalFileName: f => f,
  getNewLine: () => ts.sys.newLine,
};

function patchWatchFunctions(host, files) {
  const fileWatchers = new Map();
  const directoryWatchers = new Map();

  function callWatchers(fileName, eventKind) {
    const fileWatcher = fileWatchers.get(fileName);
    fileWatcher?.callback(fileName, eventKind);

    let dirName = path.dirname(fileName);
    let directoryWatcher = directoryWatchers.get(dirName);
    directoryWatcher?.callback(fileName);
    while (dirName !== '.' && dirName !== '/') {
      dirName = path.dirname(dirName);
      directoryWatcher = directoryWatchers.get(dirName);
      if (directoryWatcher?.recursive) {
        directoryWatcher.callback(fileName);
      }
    }
  }

  host.updateFiles = (newFiles) => {
    for (const fileName of Object.keys(files)) {
      if (!(fileName in newFiles)) {
        callWatchers(fileName, ts.FileWatcherEventKind.Deleted);
      }
    }

    for (const fileName of Object.keys(newFiles)) {
      if (!(fileName in files)) {
        callWatchers(fileName, ts.FileWatcherEventKind.Created);
      }
    }

    files = newFiles;
  };

  host.watchFile = (path, callback) => {
    console.log('watchFile', path);
    if (fileWatchers.has(path)) {
      throw new Error(`Path ${path} already has a file watcher`);
    }

    const watcher = {
      callback: (fileName, eventKind) => {
        console.log(
            'fileChangeCallback', fileName, ts.FileWatcherEventKind[eventKind]);
        callback(fileName);
      }
    };
    fileWatchers.set(path, watcher);
    return {
      close: () => {
        console.log('watchFile', path, 'closed');
        if (fileWatchers.get(path) === watcher) {
          fileWatchers.delete(path);
        }
      }
    };
  };

  host.watchDirectory = (path, callback, recursive) => {
    console.log('watchDirectory', path, recursive);
    if (directoryWatchers.has(path)) {
      throw new Error(`Path ${path} already has a directory watcher`);
    }

    const watcher = {
      callback: (fileName) => {
        console.log('directoryChangeCallback', fileName);
        callback(fileName);
      },
      recursive
    };
    directoryWatchers.set(path, watcher);
    return {
      close: () => {
        console.log('watchDirectory', path, 'closed');
        if (directoryWatchers.get(path) === watcher) {
          directoryWatchers.delete(path);
        }
      }
    };
  };

  host.fileExists = (fileName) => {
    return fileName in files;
  };

  host.readFile = (fileName) => {
    return files[fileName];
  };

  host.directoryExists = undefined;
  host.getDirectories = undefined;
  host.readDirectory = undefined;
  host.realpath = undefined;
}

const ROUNDS = [
  // Initial successful build
  {files: FILES},
  // Emulate file b.d.ts being deleted --> should error
  {files: exceptKey(FILES, '/module/b.d.ts')},
  // Emulate file b.d.ts being restored --> should succeed but errors
  {files: FILES},
];

function diagnosticReporter(diagnostic) {
  console.log(
      '[diagnosticReporter]',
      ts.formatDiagnostic(diagnostic, FORMAT_DIAGNOSTICS_HOST));
}

function watchStatusReporter(diagnostic, _newLine, _options, _errorCount) {
  console.log(
      '[watchStatusReporter]',
      ts.formatDiagnostic(diagnostic, FORMAT_DIAGNOSTICS_HOST));
}

let compilerHost;
let watch;
for (const [i, round] of ROUNDS.entries()) {
  console.log(`ROUND ${i} START`);
  if (!compilerHost || !watch) {
    compilerHost = ts.createWatchCompilerHost(
        ROOT_FILE_NAMES, COMPILER_OPTIONS, ts.sys,
        // We handle emit outselves. So
        // createEmitAndSemanticDiagnosticsBuilderProgram is not desirable.
        ts.createSemanticDiagnosticsBuilderProgram, diagnosticReporter,
        watchStatusReporter);
    patchWatchFunctions(compilerHost, round.files);
    watch = ts.createWatchProgram(compilerHost);
  } else {
    // In a real world implementation we'd have to check if compilerOptions have
    // changed and re-create the watch host and program here.
    compilerHost.updateFiles(round.files);
    watch.updateRootFileNames(ROOT_FILE_NAMES);
  }

  const program = watch.getProgram();

  const mainFileNames =
      ROOT_FILE_NAMES.filter(fileName => !fileName.startsWith('/node_modules'))
  const mainSourceFiles = program.getSourceFiles().filter(
      sf => mainFileNames.includes(sf.fileName));

  const diagnostics = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];
  for (const sf of mainSourceFiles) {
    console.log('asking for diagnostics for', sf.fileName);
    diagnostics.push(...program.getSyntacticDiagnostics(sf));
    diagnostics.push(...program.getSemanticDiagnostics(sf));
  }
  for (const sf of mainSourceFiles) {
    diagnostics.push(...program.emit(sf).diagnostics);
  }
  if (diagnostics.length > 0) {
    console.log(ts.formatDiagnostics(diagnostics, FORMAT_DIAGNOSTICS_HOST));
  }
}

watch?.close();
