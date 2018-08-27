import json from 'rollup-plugin-json';
import babel from 'rollup-plugin-babel';
import nodeResolve from 'rollup-plugin-node-resolve';
import uglify from 'rollup-plugin-uglify';
import { minify } from 'uglify-js';

const production = process.env.BUILD_ENV === 'production';

const config = {
  entry: 'src/PhotoBox.js',
  format: 'iife',
  moduleName: 'PhotoBox',
  plugins: [
    json(),
    babel(),
    nodeResolve({
      jsnext: true
    })
  ],
  dest: 'dest/photobox.js'
};

if (production) {
  config.plugins.push(uglify({}, minify));
  config.dest = 'dest/photobox.min.js';
}

export default config;