const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Set up environment variables
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

describe('Core Authentication Functions', () => {
  describe('Password Hashing', () => {
    it('should hash passwords correctly', async () => {
      const password = 'testpassword123';
      const hashedPassword = await bcrypt.hash(password, 12);
      
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(password);
      expect(hashedPassword.length).toBeGreaterThan(50);
    });

    it('should verify passwords correctly', async () => {
      const password = 'testpassword123';
      const hashedPassword = await bcrypt.hash(password, 12);
      
      const isValid = await bcrypt.compare(password, hashedPassword);
      const isInvalid = await bcrypt.compare('wrongpassword', hashedPassword);
      
      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });
  });

  describe('JWT Token Generation', () => {
    it('should generate valid JWT tokens', () => {
      const payload = { id: 'user123', username: 'testuser' };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should verify JWT tokens correctly', () => {
      const payload = { id: 'user123', username: 'testuser' };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      expect(decoded.id).toBe(payload.id);
      expect(decoded.username).toBe(payload.username);
    });

    it('should reject invalid JWT tokens', () => {
      expect(() => {
        jwt.verify('invalid-token', process.env.JWT_SECRET);
      }).toThrow();
    });

    it('should reject tokens with wrong secret', () => {
      const payload = { id: 'user123', username: 'testuser' };
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '7d' });
      
      expect(() => {
        jwt.verify(token, process.env.JWT_SECRET);
      }).toThrow();
    });
  });

  describe('Input Validation', () => {
    const validateEmail = (email) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };

    const validatePassword = (password) => {
      return Boolean(password && typeof password === 'string' && password.trim().length >= 6);
    };

    const validateUsername = (username) => {
      return Boolean(username && typeof username === 'string' && username.trim().length >= 3 && username.trim().length <= 20 && /^[a-zA-Z0-9_]+$/.test(username.trim()));
    };

    it('should validate email addresses correctly', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name+tag@domain.co.uk')).toBe(true);
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('test@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });

    it('should validate passwords correctly', () => {
      expect(validatePassword('password123')).toBe(true);
      expect(validatePassword('123456')).toBe(true);
      expect(validatePassword('12345')).toBe(false); // too short
      expect(validatePassword('')).toBe(false);
      expect(validatePassword(null)).toBe(false);
    });

    it('should validate usernames correctly', () => {
      expect(validateUsername('testuser')).toBe(true);
      expect(validateUsername('user123')).toBe(true);
      expect(validateUsername('test_user')).toBe(true);
      expect(validateUsername('ab')).toBe(false); // too short
      expect(validateUsername('a'.repeat(21))).toBe(false); // too long
      expect(validateUsername('test-user')).toBe(false); // invalid character
      expect(validateUsername('test user')).toBe(false); // space not allowed
      expect(validateUsername('')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle async errors gracefully', async () => {
      const asyncFunction = async () => {
        throw new Error('Test error');
      };

      try {
        await asyncFunction();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toBe('Test error');
      }
    });

    it('should handle JSON parsing errors', () => {
      const invalidJson = '{"invalid": json}';
      
      expect(() => {
        JSON.parse(invalidJson);
      }).toThrow();
    });
  });

  describe('Date Handling', () => {
    it('should create valid timestamps', () => {
      const now = new Date();
      const timestamp = now.toISOString();
      
      expect(timestamp).toBeDefined();
      expect(typeof timestamp).toBe('string');
      expect(new Date(timestamp).getTime()).toBe(now.getTime());
    });

    it('should handle date comparisons', () => {
      const date1 = new Date('2023-01-01');
      const date2 = new Date('2023-01-02');
      
      expect(date2.getTime()).toBeGreaterThan(date1.getTime());
      expect(date1.getTime()).toBeLessThan(date2.getTime());
    });
  });

  describe('Object Manipulation', () => {
    it('should safely access object properties', () => {
      const user = {
        _id: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        profile: {
          firstName: 'Test',
          lastName: 'User'
        }
      };

      expect(user._id).toBe('user123');
      expect(user.username).toBe('testuser');
      expect(user.profile?.firstName).toBe('Test');
      expect(user.profile?.nonexistent).toBeUndefined();
      expect(user.nonexistent?.property).toBeUndefined();
    });

    it('should filter sensitive data from objects', () => {
      const user = {
        _id: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        password: 'hashedpassword',
        refreshToken: 'refresh-token'
      };

      const { password, refreshToken, ...safeUser } = user;
      
      expect(safeUser.password).toBeUndefined();
      expect(safeUser.refreshToken).toBeUndefined();
      expect(safeUser.username).toBe('testuser');
      expect(safeUser.email).toBe('test@example.com');
    });
  });
});
