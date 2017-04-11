const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

const bucket = 'models-resources';
const dir = 'lab-offline';
const s3 = new AWS.S3();

module.exports = function uploadToS3(file) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    const key = path.basename(file);
    const params = {Bucket: bucket, Key: `${dir}/${key}`, Body: stream};
    s3.upload(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data.Location);
      }
    });
  });
};
