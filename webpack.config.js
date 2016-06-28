var webpack = require('webpack');
var path = require('path');

module.exports = {
  entry: __dirname + '/src/main.js',
  // devtool: 'source-map',
  output: {
    path: __dirname + '/dist',
    filename: 'main.js'
  },
  module: {
    loaders: [
      {
        test: /(\.jsx|\.js)$/,
        loader: 'babel',
        exclude: /(node_modules|bower_components)/,
        query: {
          presets: ['es2015']
        }
      }
    ]
  },
  resolve: {
    root: __dirname + '/src/',
    extensions: ['', '.js', '.jsx']
  }
};