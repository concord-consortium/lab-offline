# Lab Offline Interactive API

AWS Lambda function that generates standalone / offline Lab interactive, uploads it to S3 bucket and returns its URL.

Example:

https://tv4jg3zewi.execute-api.us-east-1.amazonaws.com/production/interactive?interactivePath=interactives/samples/3-100-atoms.json

It's used by [https://lab.concord.org/](https://lab.concord.org/).

## Overview

This API is built using following AWS resources:

- AWS Lambda function: `lab-offline`. It expects interactive path and returns archive URL.
- AWS API Gateway: `lab-offline`. It exposes `lab-offline` lambda function
under following URL: [https://tv4jg3zewi.execute-api.us-east-1.amazonaws.com/production/interactive](https://tv4jg3zewi.execute-api.us-east-1.amazonaws.com/production/interactive).
It's also used to map query params to the lambda input event.

## Development

All the scripts are written in JS and they require recent Node.js version. Preferably v6.10 as that's
AWS Lambda environment. Also, AWS CLI tools have to be installed and configured to automatically
deploy Lambda functions.

- `aws-lambda-func` - AWS Lambda function code. You can test it locally if provide interactive path, e.g.:

```
npm install
node aws-labda-func.js interactives/samples/3-100-atoms.json
```

- `./deploy.sh` - deploys AWS Lambda code. It requires configured AWS CLI tools.

## License 

[MIT](https://github.com/concord-consortium/lab-offline/blob/master/LICENSE)
