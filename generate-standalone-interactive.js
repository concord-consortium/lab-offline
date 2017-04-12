const zlib = require('zlib');
const path = require('path');
const tar = require('tar');
const fstream = require("fstream");
const fs = require('fs-extra');
const fetch = require('node-fetch');

const labHost = 'https://lab.concord.org';
const labStandaloneUrl = 'http://lab.concord.org/standalone/lab-interactive.tar.gz';
const jsmolOfflineUrl = 'https://models-resources.concord.org/jsmol/jsmol-offline.tar.gz';
const libBasePathPlaceholder = '<<lib-base-path>>';
const interactivePlaceholder = '//<<interactive-definition>>';

// Input: interactive path, e.g.: interactives/itsi/bond-types/3-electronegativity-orbitals-charge.json
// Output: path of the .tar.gz archive with standalone interactive page and all necessary libraries and resources.
module.exports = function generateStandaloneInteractive(interactivePath) {
  const name = interactivePath.replace(/\//g, '-').replace('.json', '') + '-' + Date.now();
  const outputPath = path.join('/tmp', name);
  // Some of those constants could be changed into configurable options,
  // that's why they're within downloadInteractive scope.
  const interactiveName = 'interactive';
  const interactivesResourcePath = 'interactive-resources/';
  const libBasePath = 'lib/';

  function downloadAndExtractArchive(url) {
    return fetch(url)
      .then(res => {
        return new Promise(resolve => {
          const dir = path.join(outputPath, libBasePath);
          fs.ensureDirSync(dir);
          const extr = tar.Extract({path: dir});
          res.body
            .pipe(zlib.Unzip())
            .pipe(extr);
          extr.on('finish', resolve);
        });
      });
  }

  function compressOutput() {
    return new Promise(resolve => {
      const archive = `${outputPath}.tar.gz`;
      const dest = fs.createWriteStream(archive);
      fstream.Reader({path: outputPath, type: 'Directory'})
        .pipe(tar.Pack({noProprietary: true}))
        .pipe(zlib.Gzip())
        .pipe(dest);
      dest.on('finish', () => {
        fs.remove(outputPath, () => {
          resolve(archive);
        });
      });
    });
  }

  function saveInteractive(interactive) {
    const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf-8');
    let output = template.replace(new RegExp(libBasePathPlaceholder, 'gm'), libBasePath);
    output = output.replace(interactivePlaceholder, 'window.INTERACTIVE = ' + JSON.stringify(interactive, null, 2));
    const outputFile = path.join(outputPath, `${interactiveName}.html`);
    fs.writeFileSync(outputFile, output);
  }

  function saveImg(imgUrl, imagePath) {
    return new Promise(resolve => {
      fetch(imgUrl)
        .then(res => {
          // Note that imagePath can include directory, e.g. 'images/img.png'.
          const dir = path.join(outputPath, interactivesResourcePath, interactiveName, path.dirname(imagePath));
          fs.ensureDirSync(dir);
          const filePath = path.join(dir, path.basename(imagePath));
          const dest = fs.createWriteStream(filePath);
          res.body.pipe(dest);
          dest.on('finish', () => {
            resolve(filePath);
          });
        });
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
    const imageUrls = images.map(i => {
      const path = imageMapping[i.imageUri] || i.imageUri;
      return {
        url: `${labHost}/${imagePath}${path}`,
        path
      };
    });
    return Promise.all(imageUrls.map(i => saveImg(i.url, i.path)))
      .then(_ => model);
  }

  function downloadJSmolIfNecessary(interactive) {
    return new Promise(resolve => {
      const interactiveText = JSON.stringify(interactive);
      if (interactiveText.indexOf('https://models-resources.concord.org/jsmol') !== -1) {
        downloadAndExtractArchive(jsmolOfflineUrl).then(_ => resolve(interactive));
      } else {
        resolve(interactive);
      }
    });
  }

  function downloadInteractiveImages(interactive) {
    const externalUrl = /^https?:\/\//i;
    const components = interactive.components || [];
    const downloadPromises = components.filter(c => c.type === 'image').map(imgDef => {
      let imgUrl = imgDef.src;
      let imgPath = path.basename(imgUrl);
      if (!externalUrl.test(imgUrl)) {
        let basePath = '';
        if (!imgDef.urlRelativeTo || imgDef.urlRelativeTo === 'model') {
          basePath = interactive.models[0].url || '';
          // Remove <model-name>.json from url.
          basePath = basePath.slice(0, basePath.lastIndexOf('/') + 1);
        }
        imgPath = imgUrl;
        imgUrl = `${labHost}/${basePath}${imgUrl}`;
      }
      // Update component so it works locally.
      imgDef.urlRelativeTo = 'page';
      imgDef.src = `${interactivesResourcePath}${interactiveName}/${path.basename(imgUrl)}`;
      return saveImg(imgUrl, imgPath);
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

  const interactivePromise = fetch(`${labHost}/${interactivePath}`)
    .then(res => res.json())
    .then(interactive => downloadJSmolIfNecessary(interactive))
    .then(interactive => downloadInteractiveImages(interactive))
    .then(interactive => processInteractive(interactive))
    .then(interactive => saveInteractive(interactive));

  const labDownloadPromise = downloadAndExtractArchive(labStandaloneUrl);

  return Promise.all([interactivePromise, labDownloadPromise])
    .then(compressOutput)
};
