const fs = require('fs-extra');
const generateStandaloneInteractive = require('./generate-standalone-interactive');
const uploadToS3 = require('./upload-to-s3');

function getResponse(url) {
  return {
    url: url
  };
}

// AWS Lambda API handler. Event consists of query params.
exports.handler = function (event, context) {
  const interactivePath = event.interactivePath;
  generateStandaloneInteractive(interactivePath)
    .then(outputPath => uploadToS3(outputPath)
      .then(url => {
        fs.removeSync(outputPath); // cleanup
        return url;
      }))
    .then(url => getResponse(url))
    .then(response => context.done(null, response))
    .catch(error => context.done(error));
};

// It's possible to test it locally, e.g.:
// node aws-lambda-func.js interactives/itsi/bond-types/3-electronegativity-orbitals-charge.json
if (process.argv[2]) {
  const query = {
    interactivePath: process.argv[2]
  };
  exports.handler(query, {
    done: function (err, result) {
      console.log(result);
      process.exit();
    }
  });
}
