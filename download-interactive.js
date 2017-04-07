const zlib = require('zlib');
const path = require('path');
const tar = require('tar');
const fstream = require("fstream");
const crypto = require('crypto');
const fs = require('fs-extra');
const fetch = require('node-fetch');

const labHost = 'https://lab.concord.org';
const labStandaloneUrl = 'http://lab.concord.org/standalone/lab-interactive.tar.gz';
const libBasePathPlaceholder = '<<lib-base-path>>';
const interactivePlaceholder = '//<<interactive-definition>>';

module.exports = function downloadInteractive(interactiveUrl, callback) {
  const outputPath = path.join('/tmp', crypto.randomBytes(16).toString("hex"));
  // Some of those constants could be changed into configurable options,
  // that's why they're within downloadInteractive scope.
  const interactiveName = 'interactive';
  const interactivesResourcePath = 'interactive-resources/';
  const libBasePath = 'lab-interactive/';

  function saveInteractive(interactive) {
    const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf-8');
    let output = template.replace(new RegExp(libBasePathPlaceholder, 'gm'), libBasePath);
    output = output.replace(interactivePlaceholder, 'window.INTERACTIVE = ' + JSON.stringify(interactive, null, 2));
    const outputFile = path.join(outputPath, `${interactiveName}.html`);
    fs.writeFileSync(outputFile, output);
  }

  function saveImg(imgUrl) {
    return fetch(imgUrl).then(res => {
      const dir = path.join(outputPath, interactivesResourcePath, interactiveName);
      fs.ensureDirSync(dir);
      const filePath = path.join(dir, path.basename(imgUrl));
      const dest = fs.createWriteStream(filePath);
      res.body.pipe(dest);
      console.log('Saved: ', path.basename(imgUrl), 'to:', filePath);
    });
  }

  function downloadModelImages(modelDef, model) {
    // Make processing simpler and create empty objects if not defined.
    if (!modelDef.modelOptions) modelDef.modelOptions = {};
    if (!modelDef.viewOptions) modelDef.viewOptions = {};

    const images = modelDef.viewOptions.images || model.viewOptions && model.viewOptions.images || [];
    const imageMapping = modelDef.viewOptions.imageMapping || model.viewOptions && model.viewOptions.imageMapping || {};
    let imagePath = modelDef.modelOptions.imagePath || model.imagePath || '';
    if (!imagePath && modelDef.url) {
      imagePath = modelDef.url.slice(0, modelDef.url.lastIndexOf('/') + 1);
    }
    const imageUrls = images.map(i => `${labHost}/${imagePath}${imageMapping[i.imageUri] || i.imageUri}`);
    return Promise.all(imageUrls.map(imgUrl => saveImg(imgUrl)))
      .then(_ => model);
  }

  function downloadInteractiveImages(interactive) {
    const externalUrl = /^https?:\/\//i;
    const downloadPromises = interactive.components.filter(c => c.type === 'image').map(imgDef => {
      let imgUrl = imgDef.src;
      if (!externalUrl.test(imgUrl)) {
        let basePath = '';
        if (!imgDef.urlRelativeTo || imgDef.urlRelativeTo === 'model') {
          basePath = interactive.models[0].url || '';
          // Remove <model-name>.json from url.
          basePath = basePath.slice(0, basePath.lastIndexOf('/') + 1);
        }
        imgUrl = `${labHost}/${basePath}${imgUrl}`;
      }
      // Update component so it works locally.
      imgDef.urlRelativeTo = 'page';
      imgDef.src = `${interactivesResourcePath}${interactiveName}/${path.basename(imgUrl)}`;
      return saveImg(imgUrl);
    });
    return Promise.all(downloadPromises)
      .then(_ => interactive);
  }

// modelDef is an object defined in interactive JSON, contains model meta properties (url, name, etc.).
// model is a model JSON, proper model file specifying model properties.
  function processModel(modelDef, model) {
    delete modelDef.url;
    modelDef.model = model;
    // Specify imagePath in modelDef.modelOptions as it always overwrites value defined in modelDef.model.
    // Some interactives can have this value already specified, so we need to make sure that the new one is used.
    modelDef.modelOptions.imagePath = `${interactivesResourcePath}${interactiveName}/`;
    // Handle JSmol models (iframe-model type specifies its own URL)
    if (model.url) {
      model.url = model.url.replace('https://models-resources.concord.org/jsmol', `${libBasePath}jsmol-offline`);
    }
    return modelDef;
  }

  function processInteractive(interactive) {
    // Remove reference to i18nMetadata, as we don't have to support language switching.
    delete interactive.i18nMetadata;

    const modelPromises = interactive.models.map(modelDef => {
      let promise;
      if (modelDef.url) {
        promise = fetch(`${labHost}/${modelDef.url}`)
          .then(res => res.json())
      } else {
        promise = new Promise(resolve => {
          resolve(modelDef.model);
        });
      }
      return promise
        .then(model => downloadModelImages(modelDef, model))
        .then(model => processModel(modelDef, model));
    });
    return Promise.all(modelPromises)
      .then(modelDefinitions => {
        interactive.models = modelDefinitions;
        return interactive;
      });
  }

  const interactivePromise = fetch(`${labHost}/${interactiveUrl}`)
    .then(res => res.json())
    .then(interactive => downloadInteractiveImages(interactive))
    .then(interactive => processInteractive(interactive))
    .then(interactive => saveInteractive(interactive));

  const labDownloadPromise = fetch(labStandaloneUrl)
    .then(res => {
      return new Promise(resolve => {
        const dest = path.join(outputPath);
        const extr = tar.Extract({path: dest});
        res.body
          .pipe(zlib.Unzip())
          .pipe(extr);
        extr.on('finish', resolve);
      });
    });

  Promise.all([interactivePromise, labDownloadPromise])
    .then(_ => {
      return new Promise(resolve => {
        const archive = `${outputPath}.tar`;
        const dest = fs.createWriteStream(archive);
        fstream.Reader({path: outputPath, type: 'Directory'})
          .pipe(tar.Pack({noProprietary: true}))
          .pipe(dest);
        dest.on('finish', () => {
          resolve(archive);
        });
      });
    })
    .then(archive => callback(archive));
};