'use babel';

import fs from 'fs';
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
    open: {
      title: 'Open the "index.js" after generated',
      type: 'boolean',
      default: true,
      order: 4
    }
  },

  $config: null,

  ignoredFiles: [
    'index.js'
  ],

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
  isIgnored(name) {
    if (name[0] === '.') return true;
    if (this.ignoredFiles.indexOf(name) !== -1) return true;
    if (this.ignoredNames === null) {
      this.ignoredNames = atom.config.get('core.ignoredNames');
    }
    if (mm.any(name, this.ignoredNames)) return true;
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

  generateContent(type, files) {
    const { EOL, quotes, terminator, tabLength } = this.getConfig();

    const content = [], moduleNames = [];

    files.forEach(path => {
      let pathInfo = parsePath(path);
      let { name, ext, base } = pathInfo;
      if (this.isIgnored(base)) return;

      // 文件名首字母大写则认为这是一个类
      let moduleName = /[A-Z]/.test(name[0]) ? upperCamelCase(name) : camelCase(name);

      // .js 文件不加后缀
      let modulePath = './' + (ext === '.js' ? name : base);

      moduleNames.push(moduleName);

      if (type === 'import') {
        content.push(
          `import ${moduleName} from ${quotes}${modulePath}${quotes}${terminator}`
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
      (type === 'import' ? 'export ' : 'module.exports = ') +
      `{${EOL}${$moduleNames.join(',' + EOL)}${EOL}}${terminator}${EOL}`
    );

    return content.join(EOL);
  },

  generateIndex(type, path) {
    fs.stat(path, (err, stats) => {
      if (err) return throwError(err);

      let targetDirectory;
      if (stats.isDirectory()) {
        targetDirectory = path;
      } else {
        targetDirectory = parsePath(path).dir;
      }

      fs.readdir(targetDirectory, (err, files) => {
        if (err) return throwError(err);

        const content = this.generateContent(type, files);

        const indexFile = sysPath.join(targetDirectory, 'index.js');

        fs.writeFile(indexFile, content, err => {
          if (err) return throwError(err);
          if (this.$config.open) {
            atom.workspace.open(indexFile);
          }
        });
      });

    });
  },

  deactivate() {
    this.subscriptions.dispose();
  }

};
