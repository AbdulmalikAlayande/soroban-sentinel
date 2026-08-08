/**
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  mutate: [
    'src/core/**/*.ts'
  ],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  reporters: ['progress', 'clear-text', 'html'],
  coverageAnalysis: 'perTest',
};
