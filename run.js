#!/usr/bin/env node

const downloadInteractive = require('./download-interactive');

const url = process.argv[2];

downloadInteractive(url, outputPath => {
  console.log('Output:', outputPath);
});
