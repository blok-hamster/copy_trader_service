import { config } from '../src/index';

describe('Configuration', () => {
  test('should have default port', () => {
    expect(config.port).toBe(3000);
  });

  test('should have development environment', () => {
    expect(config.nodeEnv).toBe('development');
  });
});
