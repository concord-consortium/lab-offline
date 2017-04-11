#!/usr/bin/env node

const downloadInteractive = require('./download-interactive');
const uploadToS3 = require('./upload-to-s3');

const url = process.argv[2];

downloadInteractive(url)
  .then(outputPath => uploadToS3(outputPath))
  .then(url => console.log('URL:', url));
