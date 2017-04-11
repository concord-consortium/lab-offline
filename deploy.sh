#!/usr/bin/env bash

echo "--- install node modules"
npm prune && npm install
echo "--- create zip archive"
zip -rq archive.zip *.js *.json node_modules *.html
echo "--- update Lambda code"
aws lambda update-function-code --function-name arn:aws:lambda:us-east-1:612297603577:function:lab-offline --zip-file fileb://archive.zip
echo "--- cleanup"
rm archive.zip
