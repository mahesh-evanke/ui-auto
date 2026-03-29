module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: ['steps-def/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: ['progress'],
  },
};
