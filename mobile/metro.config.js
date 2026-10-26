// Lets the app import the web app's shared logic from ../docs (one source of truth
// for matching, pricing and dates).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..', 'docs')];
module.exports = config;
