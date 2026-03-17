process.env.NODE_ENV = 'test';

const jest = require('jest');

jest.run(['--runInBand']);
