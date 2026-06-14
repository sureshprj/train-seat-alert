const fs = require('fs');
const Module = require('module');
const path = require('path');
const babel = require('@babel/core');

const projectRoot = path.resolve(__dirname, '..');

function loadSourceModule(relativePath, mocks = {}, cache = new Map()) {
  const filename = path.resolve(projectRoot, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;

  const source = fs.readFileSync(filename, 'utf8');
  const { code } = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: ['babel-preset-expo']
  });

  const mod = new Module(filename, module.parent);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, mod);

  mod.require = (request) => {
    const resolved = Module._resolveFilename(request, mod);
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    if (Object.prototype.hasOwnProperty.call(mocks, resolved)) return mocks[resolved];
    if (resolved.startsWith(projectRoot) && resolved.endsWith('.js')) {
      return loadSourceModule(path.relative(projectRoot, resolved), mocks, cache);
    }
    return require(resolved);
  };

  mod._compile(code, filename);
  return mod.exports;
}

module.exports = { loadSourceModule, projectRoot };
