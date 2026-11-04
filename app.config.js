// The web build can live under a sub-path (GitHub Pages serves it at /<repo>/); the deploy sets EXPO_BASE_URL.
module.exports = ({ config }) => ({
  ...config,
  experiments: { ...config.experiments, baseUrl: process.env.EXPO_BASE_URL || '' },
});
