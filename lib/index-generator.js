'use babel';

import fs from 'fs-extra';
import _omit from 'lodash.omit';
import sysPath from 'path';
import parsePath from 'parse-filepath';
import mm from 'micromatch';
import camelCase from 'camelcase';
import upperCamelCase from 'uppercamelcase';
import { CompositeDisposable } from 'atom';
import pkg from '../package.json';

const throwError = message => {
  atom.notifications.addError(`${pkg.name}: ${message}`);
};

const isDirectory = path => {
  return fs.statSync(path).isDirectory();
};

export default {

  config: {
    EOL: {
      title: 'End of line',
      type: 'string',
      default: '\\n',
      enum: ['\\n', '\\r\\n'],
      order: 1
    },
    quotes: {
      title: 'Quotes',
      description: `import foo from 'foo' or import foo from "foo"?`,
      type: 'string',
      default: '\'',
      enum: ['\'', '"'],
      order: 2
    },
    semicolon: {
      title: 'Use semicolons (;) as statement terminators',
      type: 'boolean',
      default: true,
      order: 3
    },
    ignore: {
      title: 'Ignored names',
      type: 'array',
      default: [
        '.aigrc',
        'index.js',
        '*.(md|lock|log|txt|html)'
      ],
      order: 4
    },
    open: {
      title: 'Open the "index.js" after generated',
      type: 'boolean',
      default: true,
      order: 5
    }
  },

  $config: null,

  ignoredNames: null,

  subscriptions: null,

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(

      // 如果设置为 .tree-view .directory, 因为事件冒泡, 命令会被触发两次
      atom.commands.add('.tree-view .header', {
        [`${pkg.name}:generate-index-import`]: ({ target }) => {
          const path = this.extractPath(target);
          path && this.generateIndex('import', path);
        },
        [`${pkg.name}:generate-index-require`]: ({ target }) => {
          const path = this.extractPath(target);
          path && this.generateIndex('require', path);
        }
      }),

      // 同步设置
      atom.config.observe(pkg.name, () => this.getConfig(true))
    );
  },

  extractPath(target) {
    while (!target.dataset.path && target.firstChild) {
      target = target.firstChild;
    }
    const path = target.dataset.path;
    if (!path) {
      throwError(`unable to extract path from node.`);
    }
    return path;
  },

  // 排除文件
  isIgnored(name, extraIgnoreRules = []) {
    if (name[0] === '.') return true;
    if (this.ignoredNames === null) {
      this.ignoredNames = [
        ...atom.config.get('core.ignoredNames'),
        ...this.getConfig().ignore
      ];
    }
    if (mm.any(name, [ ...this.ignoredNames, ...extraIgnoreRules])) return true;
    return false;
  },

  getConfig(refresh = false) {
    if (refresh || this.$config === null) {
      this.$config = atom.config.get(pkg.name);
      this.$config.EOL = this.$config.EOL === '\\n' ? '\n' : '\r\n';
      this.$config.terminator = this.$config.semicolon ? ';' : '';
      this.$config.tabLength = atom.config.get('editor.tabLength', {
        scope: ['source.js']
      });
    }
    return this.$config;
  },

  generateContent(type, files, extraIgnoreRules = [], runcom) {
    const { EOL, quotes, terminator, tabLength } = this.getConfig();

    const content = [], moduleNames = [], modules = {};

    files.forEach(path => {
      let pathInfo = parsePath(path);
      let { name, ext, base } = pathInfo;
      if (this.isIgnored(base, extraIgnoreRules)) return;

      if (isDirectory(path)) {
        if (runcom['recursive'] || runcom['subDir']) {
          const { modules: $modules } = this.generateIndex(
            type, path, false,
            runcom['inherit'] ? (runcom['subDir'] ? _omit(runcom, ['index']) : runcom) : {}
          );

          if (runcom['subDir']) {
            const moduleNames2 = Object.keys($modules);
            if (moduleNames2.length) {
              moduleNames2.forEach(moduleName2 => {
                modules[moduleName2] = $modules[moduleName2];
                moduleNames.push(moduleName2);
              });
              const relativePath = './' + parsePath(path).base;
              if (type === 'import') {
                content.push(
                  `import { ${moduleNames2.join(', ')} } from ${quotes}${relativePath}${quotes}${terminator}`
                );
              } else {
                content.push(
                  `const { ${moduleNames2.join(', ')} } = require(${quotes}${relativePath}${quotes})${terminator}`
                );
              }
            }
            return;
          }
        }
      }

      // 文件名首字母大写则认为这是一个类
      let moduleName = runcom.keep.indexOf(base) !== -1 ? name : (
        (runcom['class'] || /[A-Z]/.test(name[0])) ? upperCamelCase(name) : camelCase(name)
      );

      // .js 文件也加后缀，防止识别错误
      let modulePath = './' + base;

      moduleNames.push(moduleName);

      modules[moduleName] = modulePath;

      if (type === 'import') {
        content.push(
          `import${runcom['*'] ? ' * as' : ''} ${moduleName} from ${quotes}${modulePath}${quotes}${terminator}`
        );
      } else {
        content.push(
          `const ${moduleName} = require(${quotes}${modulePath}${quotes})${terminator}`
        );
      }
    });

    content.push('');

    const indentSpace = new Array(tabLength + 1).join(' ');
    const $moduleNames = moduleNames.map(moduleName => indentSpace + moduleName);
    content.push(
      (type === 'import' ? 'export ' + (runcom['default'] ? 'default ' : '') : 'module.exports = ') +
      `{${EOL}${$moduleNames.join(',' + EOL)}${EOL}}${terminator}${EOL}`
    );

    return {
      modules,
      content: content.join(EOL)
    };
  },

  generateIndex(
    type /* require or import */,
    path, /* absolute path */
    openEdit = true,
    $runcom = {}
  ) {

    // 目标文件夹
    let targetDirectory;
    if (isDirectory(path)) {
      targetDirectory = path;
    } else {
      targetDirectory = parsePath(path).dir;
    }

    // 运行时配置
    const runcom = Object.assign({
      index: 'index.js',
      ignore: [],
      keep: [],
      'default': false,
      '*': false,
      'class': false,
      recursive: true, // 递归处理
      subDir: false, // 包括子目录内的模块
      'inherit': false // 递归时将配置应用于子目录
    }, $runcom);
    const aigrcPath = sysPath.join(targetDirectory, '.aigrc');
    if (fs.existsSync(aigrcPath)) {
      Object.assign(
        runcom,
        JSON.parse(
          fs.readFileSync(aigrcPath, 'UTF-8')
        )
      );
    }

    // 子目录及文件
    const files = fs.readdirSync(targetDirectory).map(
      fileName => sysPath.join(targetDirectory, fileName)
    );

    // 生成 index.js
    const { modules, content } = this.generateContent(
      type,
      files,
      [ ...runcom.ignore, runcom.index ],
      runcom
    );

    // 写入 index.js
    const indexFile = sysPath.join(targetDirectory, runcom.index);
    fs.writeFileSync(indexFile, content);

    // 打开 index.js
    if (openEdit && this.$config.open) {
      atom.workspace.open(indexFile);
    }

    return { modules, content, indexFile };

  },

  deactivate() {
    this.subscriptions.dispose();
  }

};
