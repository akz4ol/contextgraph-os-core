import {
  computeContentAddress,
  parseContentAddress,
  isValidContentAddress,
  verifyContentAddress,
} from '../../src/core/identity/content-address.js';

describe('Content Addressing', () => {
  describe('computeContentAddress', () => {
    it('should produce deterministic addresses for the same content', () => {
      const content = { foo: 'bar', num: 42 };
      const address1 = computeContentAddress(content);
      const address2 = computeContentAddress(content);

      expect(address1).toBe(address2);
    });

    it('should produce different addresses for different content', () => {
      const content1 = { foo: 'bar' };
      const content2 = { foo: 'baz' };

      const address1 = computeContentAddress(content1);
      const address2 = computeContentAddress(content2);

      expect(address1).not.toBe(address2);
    });

    it('should produce same address regardless of key order', () => {
      const content1 = { a: 1, b: 2, c: 3 };
      const content2 = { c: 3, a: 1, b: 2 };

      const address1 = computeContentAddress(content1);
      const address2 = computeContentAddress(content2);

      expect(address1).toBe(address2);
    });

    it('should handle nested objects', () => {
      const content = {
        outer: {
          inner: {
            value: 'test',
          },
        },
      };

      const address = computeContentAddress(content);
      expect(address).toMatch(/^sha256:[a-f0-9]+$/);
    });

    it('should handle arrays', () => {
      const content = [1, 2, 3, { nested: true }];
      const address = computeContentAddress(content);

      expect(address).toMatch(/^sha256:[a-f0-9]+$/);
    });

    it('should handle null and undefined', () => {
      const address1 = computeContentAddress(null);
      const address2 = computeContentAddress(undefined);

      expect(address1).toMatch(/^sha256:[a-f0-9]+$/);
      expect(address2).toMatch(/^sha256:[a-f0-9]+$/);
    });
  });

  describe('parseContentAddress', () => {
    it('should parse valid content addresses', () => {
      const address = 'sha256:abc123def456';
      const parsed = parseContentAddress(address);

      expect(parsed).toEqual({
        algorithm: 'sha256',
        hash: 'abc123def456',
      });
    });

    it('should return null for invalid addresses', () => {
      expect(parseContentAddress('invalid' as any)).toBeNull();
      expect(parseContentAddress(':nohash' as any)).toBeNull();
      expect(parseContentAddress('nocolon' as any)).toBeNull();
    });
  });

  describe('isValidContentAddress', () => {
    it('should validate correct sha256 addresses', () => {
      const address = computeContentAddress({ test: true });
      expect(isValidContentAddress(address)).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(isValidContentAddress('invalid')).toBe(false);
      expect(isValidContentAddress('unknown:abc123')).toBe(false);
      expect(isValidContentAddress('sha256:not-hex!')).toBe(false);
    });
  });

  describe('verifyContentAddress', () => {
    it('should verify matching content', () => {
      const content = { verify: 'me' };
      const address = computeContentAddress(content);

      expect(verifyContentAddress(content, address)).toBe(true);
    });

    it('should reject non-matching content', () => {
      const content = { verify: 'me' };
      const address = computeContentAddress(content);

      expect(verifyContentAddress({ verify: 'different' }, address)).toBe(false);
    });
  });
});
